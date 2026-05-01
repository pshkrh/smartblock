import { BLOCK_PAGE, SNOOZE_DURATION_MS } from '../shared/config.js';
import { ruleIdForDomain } from '../shared/dnr.js';
import { matchesDomain } from '../shared/domain.js';
import { setSnoozed, addExtraMs, isOverLimit } from './storage.js';

export async function blockDomain(domain) {
  const id = ruleIdForDomain(domain);
  const extensionPath = `${BLOCK_PAGE}?domain=${encodeURIComponent(domain)}`;
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath } },
      condition: {
        requestDomains: [domain],
        resourceTypes: ['main_frame'],
      },
    }],
    removeRuleIds: [id],
  });
}

export async function unblockDomain(domain) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [],
    removeRuleIds: [ruleIdForDomain(domain)],
  });
}

export async function unblockAll() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules.map(r => r.id);
  if (ids.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: ids });
  }
}

export async function isDomainBlocked(domain) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.some(r => r.id === ruleIdForDomain(domain));
}

/**
 * Handle a snooze request from the block page.
 * Unblocks the domain for SNOOZE_DURATION_MS, marks it snoozed (one-time).
 */
export async function snooze(domain) {
  await setSnoozed(domain);
  await addExtraMs(domain, SNOOZE_DURATION_MS);
  await unblockDomain(domain);
}

/**
 * Redirect the active tab of a domain to the block page.
 * Used when the timer crosses the limit while a tab is already open.
 */
export async function redirectActiveTab(domain) {
  const tabs = await chrome.tabs.query({ active: true });
  for (const tab of tabs) {
    if (!tab.url) continue;
    try {
      const { hostname } = new URL(tab.url);
      if (matchesDomain(hostname, domain)) {
        const blockUrl = chrome.runtime.getURL(
          `${BLOCK_PAGE}?domain=${encodeURIComponent(domain)}&from=${encodeURIComponent(tab.url)}`
        );
        await chrome.tabs.update(tab.id, { url: blockUrl });
      }
    } catch { /* skip */ }
  }
}

/**
 * Full block: add DNR rule + redirect any open tabs.
 */
export async function enforceBlock(domain) {
  await blockDomain(domain);
  await redirectActiveTab(domain);
}
