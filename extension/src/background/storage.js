import { CACHE_TTL_MS, defaultConfig } from '../shared/config.js';
import { localDateKey } from '../shared/date.js';

// --- Config ---

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return config ?? defaultConfig();
}

export async function setConfig(config) {
  await chrome.storage.local.set({ config });
}

export async function getLimitMs(domain) {
  const config = await getConfig();
  const minutes = config.domains[domain]?.limitMinutes ?? config.defaultLimitMinutes;
  return minutes * 60 * 1000;
}

// --- Usage ---

function usageKey(domain, day = localDateKey()) {
  return `usage_${day}_${domain}`;
}

export async function getUsage(domain, day = localDateKey()) {
  const key = usageKey(domain, day);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? { ms: 0, snoozed: false, extraMs: 0 };
}

export async function setUsage(domain, data, day = localDateKey()) {
  await chrome.storage.local.set({ [usageKey(domain, day)]: data });
}

export async function addMs(domain, ms) {
  const usage = await getUsage(domain);
  usage.ms += ms;
  await setUsage(domain, usage);
  return usage;
}

export async function setSnoozed(domain) {
  const usage = await getUsage(domain);
  usage.snoozed = true;
  await setUsage(domain, usage);
}

export async function addExtraMs(domain, ms) {
  const usage = await getUsage(domain);
  usage.extraMs = (usage.extraMs ?? 0) + ms;
  await setUsage(domain, usage);
}

export async function isOverLimit(domain) {
  const [usage, limitMs] = await Promise.all([getUsage(domain), getLimitMs(domain)]);
  const effectiveLimit = limitMs + (usage.extraMs ?? 0);
  return usage.ms >= effectiveLimit;
}

// Returns all tracked domains for today by scanning storage keys.
export async function getTodayDomains() {
  const prefix = `usage_${localDateKey()}_`;
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length));
}

// --- Classification cache ---

async function cacheKey(domain, title) {
  const raw = new TextEncoder().encode(domain + '\x1f' + title);
  const buf = await crypto.subtle.digest('SHA-256', raw);
  return 'cache_' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getCached(domain, title) {
  const key = await cacheKey(domain, title);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.verdict;
}

export async function setCached(domain, title, verdict) {
  const key = await cacheKey(domain, title);
  await chrome.storage.local.set({ [key]: { verdict, ts: Date.now() } });
}

// --- Session (survives SW restarts, clears on browser close) ---

export async function getSession() {
  const { currentTab, activeSession } = await chrome.storage.session.get(['currentTab', 'activeSession']);
  return { currentTab: currentTab ?? null, activeSession: activeSession ?? null };
}

export async function setCurrentTab(tabData) {
  await chrome.storage.session.set({ currentTab: tabData });
}

export async function setActiveSession(sessionData) {
  await chrome.storage.session.set({ activeSession: sessionData });
}

// --- Reset ---

export async function getLastResetDay() {
  const { lastResetDay } = await chrome.storage.local.get('lastResetDay');
  return lastResetDay ?? null;
}

export async function setLastResetDay(day) {
  await chrome.storage.local.set({ lastResetDay: day });
}

// Removes all usage entries for today (called at midnight).
export async function resetToday() {
  const prefix = `usage_${localDateKey()}_`;
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(prefix));
  if (keys.length) await chrome.storage.local.remove(keys);
  await setLastResetDay(localDateKey());
}

// Removes all cache entries older than CACHE_TTL_MS.
export async function pruneCache() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all)
    .filter(([k, v]) => k.startsWith('cache_') && Date.now() - v.ts > CACHE_TTL_MS)
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}
