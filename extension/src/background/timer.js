import { VERDICT } from './rules.js';
import {
  addActivityMs, addMs, isOverLimit, getLimitMs, getUsage, getConfig,
  getSession, setActiveSession, setCurrentTab,
} from './storage.js';

let onLimitReached = null;
export function setLimitReachedCallback(cb) { onLimitReached = cb; }

export async function flushElapsed() {
  const { activeSession } = await getSession();
  if (!activeSession || activeSession.paused) return;

  const elapsed = Date.now() - activeSession.startTs;
  if (elapsed <= 0) return;

  // Cap elapsed so storage never exceeds the effective limit (alarms can fire late).
  const [current, limitMs] = await Promise.all([getUsage(activeSession.domain), getLimitMs(activeSession.domain)]);
  const effectiveLimit = limitMs + (current.extraMs ?? 0);
  const remaining = Math.max(0, effectiveLimit - current.ms);
  const banked = Math.min(elapsed, remaining);

  await setActiveSession({ ...activeSession, startTs: Date.now() });

  if (banked > 0) {
    const usage = await addMs(activeSession.domain, banked);
    await addActivityMs(activeSession.activityId, banked);
    if (usage.ms >= effectiveLimit && onLimitReached) {
      onLimitReached(activeSession.domain);
    }
  } else if (current.ms >= effectiveLimit && onLimitReached) {
    onLimitReached(activeSession.domain);
  }
}

export async function onVerdictChanged({ tabId, windowId, domain, verdict, url, activityId, mode }) {
  const tabData = { tabId, windowId, domain, verdict, url, activityId, mode };
  const { activeSession } = await getSession();

  if (verdict === VERDICT.ENTERTAINMENT) {
    // Switch to this entertainment tab. Flush whatever was running first.
    await flushElapsed();
    await setCurrentTab(tabData);

    // Only track domains that have an explicit limit configured.
    const config = await getConfig();
    if (!config.domains[domain]) {
      await setActiveSession(null);
      return;
    }

    const overLimit = await isOverLimit(domain);
    if (overLimit) {
      await setActiveSession(null);
      if (onLimitReached) onLimitReached(domain);
      return;
    }
    // activeSession stores windowId so we can scope stop events to the right window.
    await setActiveSession({ domain, tabId, windowId, startTs: Date.now(), activityId, mode });
    await scheduleBlockAlarm(domain);
  } else {
    // Productive/neutral tab. Only stop the entertainment session if this event
    // came from the SAME window as the entertainment (user switched away within
    // that window). A productive tab firing in a DIFFERENT window means the user
    // is just doing other things while the video plays on another monitor —
    // keep the timer running.
    if (activeSession && activeSession.windowId === windowId) {
      chrome.alarms.clear(`block_${activeSession.domain}`);
      await flushElapsed();
      await setActiveSession(null);
    }
    await setCurrentTab(tabData);
  }
}

// Called when Chrome loses focus entirely (user switches to another app).
export async function onWindowBlurred() {
  const { activeSession } = await getSession();
  if (activeSession) chrome.alarms.clear(`block_${activeSession.domain}`);
  await flushElapsed();
  await setActiveSession(null);
}

async function scheduleBlockAlarm(domain) {
  const [usage, limitMs] = await Promise.all([getUsage(domain), getLimitMs(domain)]);
  const effectiveLimit = limitMs + (usage.extraMs ?? 0);
  const remainingMs = effectiveLimit - usage.ms;
  if (remainingMs > 0) {
    chrome.alarms.create(`block_${domain}`, { when: Date.now() + remainingMs });
  }
}

export async function pauseSession() {
  const { activeSession } = await getSession();
  if (!activeSession || activeSession.paused) return;
  await flushElapsed(); // bank elapsed before pausing
  await setActiveSession({ ...activeSession, paused: true });
}

export async function resumeSession() {
  const { activeSession } = await getSession();
  if (!activeSession || !activeSession.paused) return;
  await setActiveSession({ ...activeSession, paused: false, startTs: Date.now() });
  await scheduleBlockAlarm(activeSession.domain);
}

export async function getDomainStatus(domain) {
  const [usage, limitMs] = await Promise.all([getUsage(domain), getLimitMs(domain)]);
  const effectiveLimit = limitMs + (usage.extraMs ?? 0);
  const remaining = Math.max(0, effectiveLimit - usage.ms);
  return {
    domain,
    usedMs: usage.ms,
    baseLimitMs: limitMs,
    extraMs: usage.extraMs ?? 0,
    limitMs: effectiveLimit,
    effectiveLimitMs: effectiveLimit,
    remainingMs: remaining,
    blocked: usage.ms >= effectiveLimit,
  };
}
