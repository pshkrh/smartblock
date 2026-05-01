import { defaultConfig } from '../shared/config.js';
import { localDateKey } from '../shared/date.js';

const params = new URLSearchParams(location.search);
const domain = params.get('domain') ?? '';
const fromUrl = params.get('from') ?? '';

function isSafeReturnUrl(urlString) {
  if (!urlString || !domain) return false;
  try {
    const parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function timeUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

const usageKey = `usage_${localDateKey()}_${domain}`;

async function checkShouldUnblock() {
  const [result, cfgResult] = await Promise.all([
    chrome.storage.local.get(usageKey),
    chrome.storage.local.get('config'),
  ]);
  const usage = result[usageKey] ?? { ms: 0, extraMs: 0 };
  const config = cfgResult.config ?? defaultConfig();

  // Domain removed from config entirely → always unblock regardless of usage.
  if (!config.domains[domain]) return { shouldUnblock: true, usage };

  const limitMs = config.domains[domain].limitMinutes * 60000;
  const effectiveLimit = limitMs + (usage.extraMs ?? 0);
  return { shouldUnblock: usage.ms < effectiveLimit, usage, effectiveLimit };
}

async function init() {
  document.getElementById('domain-label').textContent = domain;
  document.title = `Time's up — ${domain}`;

  const { shouldUnblock, usage } = await checkShouldUnblock();
  if (shouldUnblock) {
    resumeBrowsing();
    return;
  }

  document.getElementById('used-time').textContent = fmtMs(usage.ms);
  document.getElementById('reset-time').textContent = fmtMs(timeUntilMidnight());

  // Tick the reset countdown every second
  setInterval(() => {
    document.getElementById('reset-time').textContent = fmtMs(timeUntilMidnight());
  }, 1000);
}

function resumeBrowsing() {
  if (isSafeReturnUrl(fromUrl)) {
    location.replace(fromUrl);
    return;
  }

  if (history.length > 1) {
    history.back();
    setTimeout(() => {
      if (location.pathname.endsWith('/src/block/block.html')) {
        location.replace(`https://${domain}`);
      }
    }, 250);
    return;
  }

  location.replace(`https://${domain}`);
}

// Auto-redirect when the limit is raised or the domain is removed from config.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('config' in changes)) return;
  checkShouldUnblock().then(({ shouldUnblock }) => {
    if (shouldUnblock) resumeBrowsing();
  });
});

init();
