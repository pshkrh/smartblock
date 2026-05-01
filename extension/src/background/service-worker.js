import { MSG } from '../shared/messages.js';
import { extractDomain } from '../shared/domain.js';
import { classify } from './classifier.js';
import { VERDICT } from './rules.js';
import {
  onVerdictChanged, onWindowBlurred,
  flushElapsed, setLimitReachedCallback, getDomainStatus,
  pauseSession, resumeSession,
} from './timer.js';
import { enforceBlock, isDomainBlocked, unblockDomain } from './blocker.js';
import {
  isOverLimit, getTodayDomains, getTodayActivity, getSession,
  setCurrentTab, setActiveSession, getConfig, recordActivity,
  clearCache, clearTodayDomainData, applyActivityOverride,
} from './storage.js';
import { initAlarms, checkMissedReset, performReset, ALARM_POLL, ALARM_MIDNIGHT } from './alarms.js';
import { BLOCK_MODE, BLOCK_PAGE } from '../shared/config.js';

// Wire up the callback so timer.js can trigger blocking without a circular import.
setLimitReachedCallback(async (domain) => {
  await enforceBlock(domain);
});

// --- Initialization ---

chrome.runtime.onInstalled.addListener(async () => {
  await initAlarms();
  await checkMissedReset();
  await reconcileBlocks();
});

chrome.runtime.onStartup.addListener(async () => {
  await initAlarms();
  await checkMissedReset();
  await reconcileBlocks();
});

// Sync DNR rules with current usage vs limits.
// Runs on startup and whenever a limit changes from the popup.
async function reconcileBlocks() {
  // Bank any live elapsed time first so comparisons use current usage.
  await flushElapsed();

  const config = await getConfig();

  // Remove DNR rules for domains removed from config (always unblock) or no
  // longer over their limit (limit was raised).
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  for (const rule of rules) {
    const domain = rule.condition.requestDomains?.[0];
    if (!domain) continue;
    if (!config.domains[domain]) {
      await unblockDomain(domain);
      continue;
    }
    const over = await isOverLimit(domain);
    if (!over) await unblockDomain(domain);
  }

  // Enforce blocks for any configured domain now over its (possibly reduced) limit.
  for (const domain of Object.keys(config.domains ?? {})) {
    const over = await isOverLimit(domain);
    if (over) await enforceBlock(domain);
  }
}

// --- Tab lifecycle ---

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await handleTabFocus(tabId, windowId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  // Fire on full page load or SPA title change
  if (changeInfo.status === 'complete' || changeInfo.title) {
    await handleTabFocus(tabId, tab.windowId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { currentTab, activeSession } = await getSession();
  if (activeSession?.tabId === tabId) {
    chrome.alarms.clear(`block_${activeSession.domain}`);
    await flushElapsed();
    await setActiveSession(null);
  }
  if (currentTab?.tabId === tabId) {
    await setCurrentTab(null);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await onWindowBlurred();
  } else {
    // Re-classify active tabs in every window so an entertainment tab that kept
    // playing in another window resumes after Chrome regains focus.
    const tabs = await chrome.tabs.query({ active: true });
    const focused = tabs.filter(tab => tab.windowId === windowId);
    const others = tabs.filter(tab => tab.windowId !== windowId);
    for (const tab of [...focused, ...others]) {
      await handleTabFocus(tab.id, tab.windowId);
    }
  }
});

// --- Content script messages ---

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === MSG.TAB_INFO) {
    handleTabInfo(msg, sender.tab).catch(console.error);
    return false;
  }
  if (msg.type === MSG.GET_STATUS) {
    buildStatusResponse().then(respond).catch(() => respond({}));
    return true; // async
  }
  if (msg.type === MSG.RECONCILE) {
    reconcileBlocks().catch(console.error);
    return false;
  }
  if (msg.type === MSG.CLEAR_CACHE) {
    clearCache()
      .then(count => respond({ ok: true, count }))
      .catch(error => {
        console.error(error);
        respond({ ok: false, count: 0 });
    });
    return true;
  }
  if (msg.type === MSG.REMOVE_DOMAIN_DATA) {
    removeDomainData(msg.domain)
      .then(() => respond({ ok: true }))
      .catch(error => {
        console.error(error);
        respond({ ok: false });
      });
    return true;
  }
  if (msg.type === MSG.SET_OVERRIDE) {
    handleOverride(msg)
      .then(entry => respond({ ok: Boolean(entry), entry }))
      .catch(error => {
        console.error(error);
        respond({ ok: false, entry: null });
      });
    return true;
  }
  if (msg.type === MSG.VIDEO_PAUSED) {
    handleVideoState(sender.tab, false).catch(console.error);
    return false;
  }
  if (msg.type === MSG.VIDEO_PLAYING) {
    handleVideoState(sender.tab, true).catch(console.error);
    return false;
  }
});

// --- Alarms ---

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === ALARM_POLL) {
    await flushElapsed();
    // Re-classify the active tab (catches SPA navigation / verdict drift)
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) await handleTabFocus(tab.id, tab.windowId);
  }
  if (name === ALARM_MIDNIGHT) {
    await performReset();
  }
  if (name.startsWith('block_')) {
    const domain = name.slice(6);
    await flushElapsed();
    const over = await isOverLimit(domain);
    if (over) await enforceBlock(domain);
  }
});

// --- Core classification + timer logic ---

async function handleTabFocus(tabId, windowId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch { return; }

  const url = tab.url ?? '';
  if (!url || url.startsWith('chrome') || url.startsWith('chrome-extension')) {
    // Non-trackable page. Only stop the session if it's in the SAME window as
    // the entertainment tab (user switched tabs within that window). Entertainment
    // in another window keeps running.
    const { activeSession } = await getSession();
    if (activeSession?.windowId === tab.windowId) {
      chrome.alarms.clear(`block_${activeSession.domain}`);
      await flushElapsed();
      await setActiveSession(null);
    }
    return;
  }

  const domain = extractDomain(url);
  if (!domain) return;

  // If domain is already blocked, redirect immediately without classifying.
  const blocked = await isDomainBlocked(domain);
  if (blocked) {
    const blockUrl = chrome.runtime.getURL(
      `${BLOCK_PAGE}?domain=${encodeURIComponent(domain)}&from=${encodeURIComponent(url)}`
    );
    await chrome.tabs.update(tabId, { url: blockUrl });
    return;
  }

  // Request content from the content script.
  let info = { url, title: tab.title ?? '', snippet: '' };
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: MSG.GET_INFO });
    if (response) info = response;
  } catch { /* content script not ready yet; use tab metadata */ }

  await processTabInfo(tabId, windowId, domain, info);
}

async function handleTabInfo(msg, tab) {
  if (!tab) return;
  const domain = extractDomain(msg.url);
  if (!domain) return;

  const blocked = await isDomainBlocked(domain);
  if (blocked) return;

  await processTabInfo(tab.id, tab.windowId, domain, msg);
}

async function processTabInfo(tabId, windowId, domain, { url, title, snippet, videoPlaying }) {
  const config = await getConfig();
  const domainConfig = config.domains[domain] ?? null;
  const mode = domainConfig?.mode ?? null;
  let verdict;
  let source;

  if (mode === BLOCK_MODE.STRICT) {
    verdict = VERDICT.ENTERTAINMENT;
    source = 'strict';
  } else if (!domainConfig) {
    verdict = VERDICT.PRODUCTIVE;
    source = 'untracked';
  } else {
    const result = await classify(domain, url, title ?? '', snippet ?? '', {
      allowOllama: true,
    });
    verdict = result.verdict;
    source = result.source;
  }

  const activityId = domainConfig
    ? await recordActivity({ domain, url, title: title ?? '', verdict, source, mode: mode ?? BLOCK_MODE.SMART })
    : null;

  await onVerdictChanged({ tabId, windowId, domain, verdict, url, activityId, mode: mode ?? BLOCK_MODE.SMART });

  if (verdict === VERDICT.ENTERTAINMENT) {
    // Only enforce limits for explicitly configured domains.
    if (!domainConfig) return;

    // Smart video pages should only count while media is actually playing.
    // Confirm after a short delay because YouTube can emit stale paused state
    // while swapping player elements.
    if (mode !== BLOCK_MODE.STRICT && videoPlaying === false) {
      const stillPaused = await confirmNoVideoPlaying(tabId);
      if (stillPaused) await pauseSession();
    }

    // Re-check limit (may have crossed while classifying).
    const over = await isOverLimit(domain);
    if (over) await enforceBlock(domain);
  }
}

async function handleVideoState(tab, playing) {
  if (!tab?.id) return;

  const { activeSession } = await getSession();
  if (!activeSession || activeSession.tabId !== tab.id || activeSession.windowId !== tab.windowId) {
    return;
  }
  if (activeSession.mode === BLOCK_MODE.STRICT) return;

  if (playing) {
    await resumeSession();
  } else {
    const stillPaused = await confirmNoVideoPlaying(tab.id);
    if (stillPaused) await pauseSession();
  }

}

async function confirmNoVideoPlaying(tabId) {
  await new Promise(resolve => setTimeout(resolve, 300));
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: MSG.GET_INFO });
    return response?.videoPlaying === false;
  } catch {
    return false;
  }
}

async function buildStatusResponse() {
  const [domains, activity] = await Promise.all([getTodayDomains(), getTodayActivity()]);
  const statuses = await Promise.all(domains.map(d => getDomainStatus(d)));
  return { domains: statuses, activity };
}

async function handleOverride({ id, verdict }) {
  if (!['productive', 'entertainment'].includes(verdict)) return null;
  const { activeSession } = await getSession();
  if (verdict === VERDICT.PRODUCTIVE && activeSession?.activityId === id) {
    chrome.alarms.clear(`block_${activeSession.domain}`);
    await setActiveSession(null);
  }

  const entry = await applyActivityOverride({ id, verdict });
  if (!entry) return null;

  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const matchingTabs = tabs.filter(tab => tab.url === entry.url);
  for (const tab of matchingTabs) {
    await handleTabFocus(tab.id, tab.windowId);
  }

  return entry;
}

async function removeDomainData(domain) {
  if (!domain) return;
  const { activeSession, currentTab } = await getSession();
  if (activeSession?.domain === domain) {
    chrome.alarms.clear(`block_${domain}`);
    await setActiveSession(null);
  }
  if (currentTab?.domain === domain) {
    await setCurrentTab(null);
  }
  await clearTodayDomainData(domain);
  await unblockDomain(domain);
}
