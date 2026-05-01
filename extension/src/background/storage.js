import { ACTIVITY_LIMIT, BLOCK_MODE, CACHE_TTL_MS, defaultConfig } from '../shared/config.js';
import { localDateKey } from '../shared/date.js';

// --- Config ---

function normalizeDomainConfig(domainConfig, fallbackLimitMinutes) {
  const limitMinutes = Number.isFinite(domainConfig?.limitMinutes)
    ? domainConfig.limitMinutes
    : fallbackLimitMinutes;
  const mode = Object.values(BLOCK_MODE).includes(domainConfig?.mode)
    ? domainConfig.mode
    : BLOCK_MODE.SMART;
  return { ...domainConfig, limitMinutes, mode };
}

function normalizeConfig(config) {
  const defaults = defaultConfig();
  const source = config ?? defaults;
  const defaultLimitMinutes = Number.isFinite(source.defaultLimitMinutes)
    ? source.defaultLimitMinutes
    : defaults.defaultLimitMinutes;
  const domains = {};

  for (const [domain, domainConfig] of Object.entries(source.domains ?? {})) {
    domains[domain] = normalizeDomainConfig(domainConfig, defaultLimitMinutes);
  }

  return { ...source, defaultLimitMinutes, domains };
}

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return normalizeConfig(config);
}

export async function setConfig(config) {
  await chrome.storage.local.set({ config: normalizeConfig(config) });
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
  return result[key] ?? { ms: 0, extraMs: 0 };
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

export async function clearTodayDomainData(domain) {
  await chrome.storage.local.remove(usageKey(domain));

  const key = activityKey();
  const result = await chrome.storage.local.get(key);
  const entries = result[key] ?? [];
  const kept = entries.filter(entry => entry.domain !== domain);
  if (kept.length !== entries.length) {
    await chrome.storage.local.set({ [key]: kept.map(normalizeActivityEntry) });
  }
}

// --- Classification cache ---

async function cacheKey(domain, url, title) {
  const raw = new TextEncoder().encode(domain + '\x1f' + url + '\x1f' + title);
  const buf = await crypto.subtle.digest('SHA-256', raw);
  return 'cache_' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getCached(domain, url, title) {
  const key = await cacheKey(domain, url, title);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.verdict;
}

export async function setCached(domain, url, title, verdict) {
  const key = await cacheKey(domain, url, title);
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

export async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('cache_'));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

// --- Manual classification overrides ---

async function overrideKey(domain, url, title) {
  const raw = new TextEncoder().encode(domain + '\x1f' + url + '\x1f' + title);
  const buf = await crypto.subtle.digest('SHA-256', raw);
  return 'override_' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getOverride(domain, url, title) {
  const key = await overrideKey(domain, url, title);
  const result = await chrome.storage.local.get(key);
  return result[key]?.verdict ?? null;
}

export async function setOverride({ domain, url, title, verdict }) {
  const key = await overrideKey(domain, url, title);
  await chrome.storage.local.set({ [key]: { domain, url, title, verdict, ts: Date.now() } });
}

// --- Activity log ---

function activityKey(day = localDateKey()) {
  return `activity_${day}`;
}

async function hashKey(prefix, value) {
  const raw = new TextEncoder().encode(value);
  const buf = await crypto.subtle.digest('SHA-256', raw);
  return prefix + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeActivityEntry(entry) {
  return {
    id: entry.id,
    domain: entry.domain,
    url: entry.url,
    title: entry.title || entry.domain,
    verdict: entry.verdict,
    source: entry.source,
    mode: entry.mode,
    countedMs: entry.countedMs ?? 0,
    overridden: entry.source === 'override',
    firstSeenTs: entry.firstSeenTs,
    lastSeenTs: entry.lastSeenTs,
  };
}

export async function getTodayActivity() {
  const result = await chrome.storage.local.get(activityKey());
  return (result[activityKey()] ?? []).map(normalizeActivityEntry);
}

export async function recordActivity({ domain, url, title, verdict, source, mode }) {
  const now = Date.now();
  const id = await hashKey('activity_', `${localDateKey()}\x1f${domain}\x1f${url}\x1f${title}`);
  const key = activityKey();
  const result = await chrome.storage.local.get(key);
  const entries = result[key] ?? [];
  const existing = entries.find(entry => entry.id === id);

  if (existing) {
    const wasCounted = existing.verdict === 'entertainment';
    const isCounted = verdict === 'entertainment';
    existing.verdict = verdict;
    existing.source = source;
    existing.mode = mode;
    if (wasCounted && !isCounted) existing.countedMs = 0;
    existing.lastSeenTs = now;
  } else {
    entries.unshift({
      id,
      domain,
      url,
      title: title || domain,
      verdict,
      source,
      mode,
      countedMs: 0,
      firstSeenTs: now,
      lastSeenTs: now,
    });
  }

  const trimmed = entries
    .sort((a, b) => b.lastSeenTs - a.lastSeenTs)
    .slice(0, ACTIVITY_LIMIT)
    .map(normalizeActivityEntry);
  await chrome.storage.local.set({ [key]: trimmed });
  return id;
}

export async function addActivityMs(activityId, ms) {
  if (!activityId || ms <= 0) return;

  const key = activityKey();
  const result = await chrome.storage.local.get(key);
  const entries = result[key] ?? [];
  const entry = entries.find(item => item.id === activityId);
  if (!entry) return;

  entry.countedMs = (entry.countedMs ?? 0) + ms;
  entry.lastSeenTs = Date.now();
  await chrome.storage.local.set({ [key]: entries.map(normalizeActivityEntry) });
}

export async function applyActivityOverride({ id, verdict }) {
  const key = activityKey();
  const result = await chrome.storage.local.get(key);
  const entries = result[key] ?? [];
  const entry = entries.find(item => item.id === id);
  if (!entry) return null;

  const wasCounted = entry.verdict === 'entertainment';
  const isCounted = verdict === 'entertainment';
  entry.verdict = verdict;
  entry.source = 'override';
  if (wasCounted && !isCounted) entry.countedMs = 0;
  entry.lastSeenTs = Date.now();

  await setOverride({
    domain: entry.domain,
    url: entry.url,
    title: entry.title,
    verdict,
  });
  await chrome.storage.local.set({ [key]: entries.map(normalizeActivityEntry) });
  return normalizeActivityEntry(entry);
}
