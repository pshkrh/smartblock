import { MSG } from '../shared/messages.js';
import { DEFAULT_LIMIT_MINUTES, defaultConfig } from '../shared/config.js';
import { checkOllamaReachable } from '../shared/ollama.js';
import { ruleIdForDomain } from '../shared/dnr.js';
import { extractDomain } from '../shared/domain.js';

// Cache Ollama reachability — checking every second would spam the network.
let ollamaOk = false;
let ollamaCheckedAt = 0;
async function getOllamaStatus() {
  if (Date.now() - ollamaCheckedAt > 15000) {
    ollamaOk = await checkOllamaReachable();
    ollamaCheckedAt = Date.now();
  }
  return ollamaOk;
}

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isValidHostname(hostname) {
  if (!hostname || hostname.length > 253) return false;
  const labels = hostname.split('.');
  if (labels.length < 2 || !/^[a-z]{2,}$/.test(labels.at(-1))) return false;
  return labels.every(label =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
}

function normalizeDomainInput(value) {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./, '');
  if (!isValidHostname(hostname)) return null;
  return extractDomain(`https://${hostname}/`);
}

function addTag(parent, className, text) {
  const tag = document.createElement('span');
  tag.className = `tag ${className}`;
  tag.textContent = text;
  parent.appendChild(tag);
}

function buildUsageRow({ domain, usedMs, effectiveLimit, blocked, snoozed, activeSession, sessionPaused }) {
  const tr = document.createElement('tr');
  if (blocked) tr.classList.add('blocked');

  const domainCell = document.createElement('td');
  domainCell.className = 'domain-cell';
  const domainName = document.createElement('span');
  domainName.className = 'domain-name';
  domainName.textContent = domain;
  domainCell.appendChild(domainName);
  if (blocked) addTag(domainCell, 'blocked-tag', 'blocked');
  if (snoozed) addTag(domainCell, 'snoozed-tag', 'snoozed');
  if (!blocked && activeSession?.domain === domain && sessionPaused) {
    addTag(domainCell, 'paused-tag', 'paused');
  }

  const usedCell = document.createElement('td');
  usedCell.className = 'used-cell';
  const barWrap = document.createElement('div');
  barWrap.className = 'bar-wrap';
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.width = `${Math.min(100, Math.round((usedMs / effectiveLimit) * 100))}%`;
  barWrap.appendChild(bar);
  const usedLabel = document.createElement('span');
  usedLabel.className = 'used-label';
  usedLabel.textContent = fmtMs(usedMs);
  usedCell.append(barWrap, usedLabel);

  const limitCell = document.createElement('td');
  const limitWrap = document.createElement('div');
  limitWrap.className = 'limit-wrap';
  const input = document.createElement('input');
  input.className = 'limit-input';
  input.type = 'number';
  input.min = '1';
  input.max = '1440';
  input.value = String(Math.round(effectiveLimit / 60000));
  input.dataset.domain = domain;
  const unit = document.createElement('span');
  unit.className = 'unit-label';
  unit.textContent = 'min';
  limitWrap.append(input, unit);
  limitCell.appendChild(limitWrap);

  const actionCell = document.createElement('td');
  actionCell.className = 'action-cell';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.dataset.domain = domain;
  removeBtn.title = 'Remove limit';
  removeBtn.textContent = '×';
  actionCell.appendChild(removeBtn);

  tr.append(domainCell, usedCell, limitCell, actionCell);
  return tr;
}

async function loadStatus() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: MSG.GET_STATUS }, response => {
      void chrome.runtime.lastError; // suppress "no receiving end" when SW is inactive
      resolve(response);
    });
  });
}

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return config ?? defaultConfig();
}

async function saveConfig(config) {
  await chrome.storage.local.set({ config });
}

async function render() {
  // Skip rebuild if the user is editing a limit input to avoid resetting focus.
  if (document.activeElement?.classList.contains('limit-input')) return;

  const [status, config, isOllamaOk, sessionData] = await Promise.all([
    loadStatus(),
    getConfig(),
    getOllamaStatus(),
    chrome.storage.session.get('activeSession'),
  ]);

  const activeSession = sessionData.activeSession ?? null;
  const sessionPaused = activeSession?.paused ?? false;
  const liveElapsedMs = (activeSession && !sessionPaused) ? Date.now() - activeSession.startTs : 0;

  // Status badge
  const badge = document.getElementById('status-badge');
  badge.textContent = isOllamaOk ? 'Ollama ✓' : 'Ollama offline';
  badge.className = 'badge ' + (isOllamaOk ? 'ok' : 'offline');

  // Usage table
  const tbody = document.getElementById('usage-body');
  const emptyRow = document.getElementById('empty-row');
  const domains = status?.domains ?? [];

  // Only show domains that have an explicit limit configured.
  // Domains with usage but no limit (removed from config) should not appear.
  const allDomains = Object.keys(config.domains ?? {});

  // Always clear stale rows before deciding what to render.
  [...tbody.querySelectorAll('tr:not(#empty-row)')].forEach(r => r.remove());

  if (allDomains.length === 0) {
    emptyRow.style.display = '';
    return;
  }
  emptyRow.style.display = 'none';

  for (const domain of allDomains) {
    const stat = domains.find(d => d.domain === domain);
    const limitMs = (config.domains[domain]?.limitMinutes ?? config.defaultLimitMinutes) * 60000;
    const storedMs = stat?.usedMs ?? 0;
    // Add live elapsed for the domain currently being tracked.
    const usedMs = storedMs + (activeSession?.domain === domain ? liveElapsedMs : 0);
    const effectiveLimit = limitMs + (stat?.extraMs ?? 0);
    const blocked = stat?.blocked ?? false;
    const snoozed = stat?.snoozed ?? false;

    tbody.appendChild(buildUsageRow({
      domain,
      usedMs,
      effectiveLimit,
      blocked,
      snoozed,
      activeSession,
      sessionPaused,
    }));
  }

  // Limit edit handlers
  tbody.querySelectorAll('.limit-input').forEach(input => {
    async function saveLimit() {
      const domain = input.dataset.domain;
      const mins = parseInt(input.value, 10);
      if (!mins || mins < 1) return;
      const cfg = await getConfig();
      cfg.domains[domain] = { ...cfg.domains[domain], limitMinutes: mins };
      await saveConfig(cfg);
      // Raising the limit may lift a block — let the SW reconcile.
      chrome.runtime.sendMessage({ type: MSG.RECONCILE }).catch(() => {});
    }
    input.addEventListener('change', saveLimit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur(); saveLimit(); } });
  });

  // Remove handlers
  tbody.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const cfg = await getConfig();
      delete cfg.domains[domain];
      await saveConfig(cfg);
      // Remove the DNR rule directly from the popup — don't rely on the service
      // worker being awake to process a RECONCILE message.
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: [ruleIdForDomain(domain)],
      });
      await render();
    });
  });
}

// Add new domain limit
const domainInput = document.getElementById('add-domain');
const minsInput   = document.getElementById('add-minutes');
const errorEl     = document.getElementById('add-error');

async function addDomain() {
  const domain = normalizeDomainInput(domainInput.value);
  const mins = parseInt(minsInput.value, 10);

  errorEl.textContent = '';
  if (!domain) {
    errorEl.textContent = 'Enter a valid domain (e.g. youtube.com)';
    return;
  }
  if (!mins || mins < 1) {
    errorEl.textContent = 'Enter a positive number of minutes';
    return;
  }

  const cfg = await getConfig();
  cfg.domains[domain] = { limitMinutes: mins };
  await saveConfig(cfg);
  domainInput.value = '';
  minsInput.value = String(DEFAULT_LIMIT_MINUTES);
  await render();
}

document.getElementById('add-btn').addEventListener('click', addDomain);

function onEnter(e) { if (e.key === 'Enter') addDomain(); }
domainInput.addEventListener('keydown', onEnter);
minsInput.addEventListener('keydown', onEnter);

render();
// Tick every second for a live counter; Ollama check is cached to every 15s.
setInterval(render, 1000);
