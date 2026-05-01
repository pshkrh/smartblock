import { MSG } from '../shared/messages.js';
import { defaultConfig } from '../shared/config.js';
import { localDateKey } from '../shared/date.js';

const params = new URLSearchParams(location.search);
const domain = params.get('domain') ?? '';
const fromUrl = params.get('from') ?? `https://${domain}`;

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
  const usage = result[usageKey] ?? { ms: 0, snoozed: false, extraMs: 0 };
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
    location.replace(fromUrl || `https://${domain}`);
    return;
  }

  document.getElementById('used-time').textContent = fmtMs(usage.ms);
  document.getElementById('reset-time').textContent = fmtMs(timeUntilMidnight());

  const snoozeBtn = document.getElementById('snooze-btn');
  const snoozeUsed = document.getElementById('snooze-used');

  if (usage.snoozed) {
    snoozeBtn.style.display = 'none';
    snoozeUsed.style.display = '';
  } else {
    snoozeBtn.addEventListener('click', async () => {
      snoozeBtn.disabled = true;
      snoozeBtn.textContent = 'Resuming…';
      await chrome.runtime.sendMessage({ type: MSG.SNOOZE, domain });
      location.href = fromUrl;
    });
  }

  // Tick the reset countdown every second
  setInterval(() => {
    document.getElementById('reset-time').textContent = fmtMs(timeUntilMidnight());
  }, 1000);
}

// Auto-redirect when the limit is raised or the domain is removed from config.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('config' in changes)) return;
  checkShouldUnblock().then(({ shouldUnblock }) => {
    if (shouldUnblock) location.replace(fromUrl || `https://${domain}`);
  });
});

init();
