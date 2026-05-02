import { BLOCK_PAGE } from '../shared/config.js';
import { ruleIdForDomain } from '../shared/dnr.js';
import { matchesDomain } from '../shared/domain.js';

const RULE_IDS_KEY = 'dnrRuleIds';
const RULE_ID_MIN = 100000;
const RULE_ID_MAX = 999999;

async function getRuleIdMap() {
  const result = await chrome.storage.local.get(RULE_IDS_KEY);
  return result[RULE_IDS_KEY] ?? {};
}

async function saveRuleIdMap(map) {
  await chrome.storage.local.set({ [RULE_IDS_KEY]: map });
}

function ruleMatchesDomain(rule, domain) {
  return rule.condition?.requestDomains?.includes(domain);
}

async function ruleIdForBlockedDomain(domain) {
  const [map, rules] = await Promise.all([
    getRuleIdMap(),
    chrome.declarativeNetRequest.getDynamicRules(),
  ]);
  const existing = map[domain];
  if (existing && !rules.some(rule => rule.id === existing && !ruleMatchesDomain(rule, domain))) {
    return existing;
  }

  const usedIds = new Set(rules.map(rule => rule.id));
  let id = ruleIdForDomain(domain);
  while (usedIds.has(id) && !rules.some(rule => rule.id === id && ruleMatchesDomain(rule, domain))) {
    id += 1;
    if (id > RULE_ID_MAX) id = RULE_ID_MIN;
  }

  map[domain] = id;
  await saveRuleIdMap(map);
  return id;
}

export async function blockDomain(domain) {
  const id = await ruleIdForBlockedDomain(domain);
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const staleIds = existingRules
    .filter(rule => rule.id !== id && ruleMatchesDomain(rule, domain))
    .map(rule => rule.id);
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
    removeRuleIds: [id, ...staleIds],
  });
}

export async function unblockDomain(domain) {
  const map = await getRuleIdMap();
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules
    .filter(rule => ruleMatchesDomain(rule, domain) || rule.id === map[domain])
    .map(rule => rule.id);
  if (!ids.length) {
    delete map[domain];
    await saveRuleIdMap(map);
    return;
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [],
    removeRuleIds: ids,
  });
  delete map[domain];
  await saveRuleIdMap(map);
}

export async function unblockAll() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules.map(r => r.id);
  if (ids.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: ids });
  }
  await saveRuleIdMap({});
}

export async function isDomainBlocked(domain) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.some(rule => ruleMatchesDomain(rule, domain));
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
