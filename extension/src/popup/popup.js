import { MSG } from '../shared/messages.js';
import { BLOCK_MODE, DEFAULT_LIMIT_MINUTES, defaultConfig } from '../shared/config.js';
import { getOllamaStatus as fetchOllamaStatus, listInstalledModels } from '../shared/ollama.js';
import { extractDomain } from '../shared/domain.js';

// Cache Ollama reachability — checking every second would spam the network.
let ollamaStatus = { ok: false, reason: 'unselected', model: '', models: [] };
let ollamaCheckedAt = 0;
let installedModels = [];
let modelsCheckedAt = 0;

async function getOllamaStatus(model) {
  if (Date.now() - ollamaCheckedAt > 15000) {
    ollamaStatus = await fetchOllamaStatus(model);
    ollamaCheckedAt = Date.now();
  }
  return ollamaStatus;
}

async function refreshOllamaStatus(model) {
  ollamaStatus = await fetchOllamaStatus(model);
  ollamaCheckedAt = Date.now();
  return ollamaStatus;
}

async function getInstalledModels() {
  if (Date.now() - modelsCheckedAt > 15000) {
    installedModels = await listInstalledModels();
    modelsCheckedAt = Date.now();
  }
  return installedModels;
}

async function refreshInstalledModels() {
  installedModels = await listInstalledModels();
  modelsCheckedAt = Date.now();
  return installedModels;
}

function ollamaStatusLabel(status) {
  if (status.ok) return '✓';
  if (status.reason === 'unselected') return '?';
  if (status.reason === 'missing_model') return '!';
  return '×';
}

function ollamaStatusTitle(status) {
  if (status.ok) return 'Model available in Ollama';
  if (status.reason === 'unselected') return 'Select an Ollama model';
  if (status.reason === 'missing_model') return 'Selected model not installed';
  return 'Ollama offline';
}

function renderModelOptions(selectedModel, models) {
  const select = document.getElementById('model-select');
  select.textContent = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = models.length === 0 ? 'No models found' : 'Select model';
  placeholder.selected = !selectedModel;
  select.appendChild(placeholder);

  const uniqueModels = [...new Set([selectedModel, ...models].filter(Boolean))];
  for (const model of uniqueModels) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    option.selected = model === selectedModel;
    select.appendChild(option);
  }

  select.disabled = models.length === 0;
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

function modeLabel(mode) {
  return mode === BLOCK_MODE.STRICT ? 'Strict' : 'Smart';
}

function sourceLabel(source) {
  if (source === 'ollama') return 'Ollama';
  if (source === 'cache') return 'Cache';
  if (source === 'strict') return 'Strict';
  if (source === 'fallback') return 'Offline';
  if (source === 'override') return 'Manual';
  return 'Rule';
}

function buildUsageRow({ domain, mode, usedMs, baseLimitMs, effectiveLimitMs, blocked, activeSession, sessionPaused }) {
  const tr = document.createElement('tr');
  if (blocked) tr.classList.add('blocked');

  const domainCell = document.createElement('td');
  domainCell.className = 'domain-cell';
  const domainName = document.createElement('span');
  domainName.className = 'domain-name';
  domainName.textContent = domain;
  domainCell.appendChild(domainName);
  if (blocked) addTag(domainCell, 'blocked-tag', 'blocked');
  if (!blocked && activeSession?.domain === domain && sessionPaused) {
    addTag(domainCell, 'paused-tag', 'paused');
  }

  const modeCell = document.createElement('td');
  const modeSelect = document.createElement('select');
  modeSelect.className = 'mode-select';
  modeSelect.dataset.domain = domain;
  for (const value of Object.values(BLOCK_MODE)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = modeLabel(value);
    option.selected = value === mode;
    modeSelect.appendChild(option);
  }
  modeCell.appendChild(modeSelect);

  const usedCell = document.createElement('td');
  usedCell.className = 'used-cell';
  const barWrap = document.createElement('div');
  barWrap.className = 'bar-wrap';
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.width = `${Math.min(100, Math.round((usedMs / effectiveLimitMs) * 100))}%`;
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
  input.value = String(Math.round(baseLimitMs / 60000));
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

  tr.append(domainCell, modeCell, usedCell, limitCell, actionCell);
  return tr;
}

function buildActivityRow(entry) {
  const item = document.createElement('article');
  item.className = 'activity-item';
  if (entry.verdict === 'entertainment') item.classList.add('counted');

  const main = document.createElement('div');
  main.className = 'activity-main';

  const title = document.createElement('a');
  title.className = 'activity-title';
  title.textContent = entry.title || entry.domain;
  title.href = entry.url;
  title.target = '_blank';
  title.rel = 'noreferrer';

  const meta = document.createElement('div');
  meta.className = 'activity-meta';
  meta.textContent = entry.domain;

  main.append(title, meta);

  const aside = document.createElement('div');
  aside.className = 'activity-aside';
  const verdict = document.createElement('span');
  verdict.className = `verdict ${entry.verdict === 'entertainment' ? 'entertainment' : 'productive'}`;
  verdict.textContent = entry.verdict === 'entertainment' ? 'Counted' : 'Ignored';
  const source = document.createElement('span');
  source.className = 'source';
  source.textContent = `${modeLabel(entry.mode)} · ${sourceLabel(entry.source)}`;
  const time = document.createElement('span');
  time.className = 'activity-time';
  time.textContent = fmtMs(entry.countedMs ?? 0);
  const overrideBtn = document.createElement('button');
  overrideBtn.className = 'override-btn';
  overrideBtn.dataset.activityId = entry.id;
  overrideBtn.dataset.verdict = entry.verdict === 'entertainment' ? 'productive' : 'entertainment';
  overrideBtn.textContent = entry.verdict === 'entertainment' ? 'Ignore' : 'Count';
  overrideBtn.title = entry.verdict === 'entertainment' ? 'Mark this page as productive' : 'Mark this page as distracting';
  aside.append(verdict, source, time, overrideBtn);

  item.append(main, aside);
  return item;
}

async function loadStatus() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: MSG.GET_STATUS }, response => {
      void chrome.runtime.lastError; // suppress "no receiving end" when SW is inactive
      resolve(response);
    });
  });
}

async function clearClassificationCache() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: MSG.CLEAR_CACHE }, response => {
      void chrome.runtime.lastError;
      resolve(response ?? { ok: false, count: 0 });
    });
  });
}

async function removeDomainData(domain) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: MSG.REMOVE_DOMAIN_DATA, domain }, response => {
      void chrome.runtime.lastError;
      resolve(response ?? { ok: false });
    });
  });
}

async function setActivityOverride(id, verdict) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: MSG.SET_OVERRIDE, id, verdict }, response => {
      void chrome.runtime.lastError;
      resolve(response ?? { ok: false, entry: null });
    });
  });
}

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  const defaults = defaultConfig();
  const cfg = config ?? defaults;
  return {
    ...defaults,
    ...cfg,
    domains: cfg.domains ?? {},
    ollamaModel: typeof cfg.ollamaModel === 'string' ? cfg.ollamaModel.trim() : defaults.ollamaModel,
  };
}

async function saveConfig(config) {
  await chrome.storage.local.set({ config });
}

async function render() {
  // Skip rebuild if the user is editing row controls to avoid resetting focus.
  if (document.activeElement?.classList.contains('limit-input') ||
      document.activeElement?.classList.contains('mode-select')) return;

  const config = await getConfig();
  const [status, models, ollama, sessionData] = await Promise.all([
    loadStatus(),
    getInstalledModels(),
    getOllamaStatus(config.ollamaModel),
    chrome.storage.session.get('activeSession'),
  ]);

  const activeSession = sessionData.activeSession ?? null;
  const sessionPaused = activeSession?.paused ?? false;
  const liveElapsedMs = (activeSession && !sessionPaused) ? Date.now() - activeSession.startTs : 0;

  // Status badge
  const badge = document.getElementById('status-badge');
  badge.textContent = ollamaStatusLabel(ollama);
  const badgeState = ollama.ok ? 'ok' : (ollama.reason === 'offline' ? 'offline' : 'missing');
  badge.className = `badge ${badgeState}`;
  badge.title = ollamaStatusTitle(ollama);

  renderModelOptions(config.ollamaModel, models);

  // Usage table
  const tbody = document.getElementById('usage-body');
  const emptyRow = document.getElementById('empty-row');
  const domains = status?.domains ?? [];
  const activity = status?.activity ?? [];

  // Only show domains that have an explicit limit configured.
  // Domains with usage but no limit (removed from config) should not appear.
  const allDomains = Object.keys(config.domains ?? {});

  // Always clear stale rows before deciding what to render.
  [...tbody.querySelectorAll('tr:not(#empty-row)')].forEach(r => r.remove());

  if (allDomains.length === 0) {
    emptyRow.style.display = '';
  } else {
    emptyRow.style.display = 'none';

    for (const domain of allDomains) {
      const stat = domains.find(d => d.domain === domain);
      const domainConfig = config.domains[domain] ?? {};
      const baseLimitMs = (domainConfig.limitMinutes ?? config.defaultLimitMinutes) * 60000;
      const effectiveLimitMs = stat?.effectiveLimitMs ?? stat?.limitMs ?? baseLimitMs;
      const storedMs = stat?.usedMs ?? 0;
      // Add live elapsed for the domain currently being tracked.
      const usedMs = storedMs + (activeSession?.domain === domain ? liveElapsedMs : 0);
      const blocked = stat?.blocked ?? false;

      tbody.appendChild(buildUsageRow({
        domain,
        mode: domainConfig.mode ?? BLOCK_MODE.SMART,
        usedMs,
        baseLimitMs,
        effectiveLimitMs,
        blocked,
        activeSession,
        sessionPaused,
      }));
    }
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

  // Mode edit handlers
  tbody.querySelectorAll('.mode-select').forEach(select => {
    select.addEventListener('change', async () => {
      const domain = select.dataset.domain;
      const cfg = await getConfig();
      cfg.domains[domain] = { ...cfg.domains[domain], mode: select.value };
      await saveConfig(cfg);
      chrome.runtime.sendMessage({ type: MSG.RECONCILE }).catch(() => {});
      await render();
    });
  });

  // Remove handlers
  tbody.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const cfg = await getConfig();
      delete cfg.domains[domain];
      await saveConfig(cfg);
      await removeDomainData(domain);
      await render();
    });
  });

  const activityForDisplay = activity.map(entry => {
    if (entry.id === activeSession?.activityId && entry.verdict === 'entertainment') {
      return { ...entry, countedMs: (entry.countedMs ?? 0) + liveElapsedMs };
    }
    return entry;
  });

  const countedTotal = activityForDisplay.reduce((sum, entry) => sum + (entry.countedMs ?? 0), 0);
  const ignoredTotal = activityForDisplay.filter(entry => entry.verdict !== 'entertainment').length;
  document.getElementById('counted-total').textContent = fmtMs(countedTotal);
  document.getElementById('ignored-total').textContent = String(ignoredTotal);

  const list = document.getElementById('activity-list');
  const activityEmpty = document.getElementById('activity-empty');
  [...list.querySelectorAll('.activity-item')].forEach(item => item.remove());
  if (activityForDisplay.length === 0) {
    activityEmpty.style.display = '';
  } else {
    activityEmpty.style.display = 'none';
    for (const entry of activityForDisplay.slice(0, 60)) {
      list.appendChild(buildActivityRow(entry));
    }
  }

  list.querySelectorAll('.override-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await setActivityOverride(btn.dataset.activityId, btn.dataset.verdict);
      await render();
    });
  });
}

// Add new domain limit
const domainInput = document.getElementById('add-domain');
const modeInput = document.getElementById('add-mode');
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
  cfg.domains[domain] = { limitMinutes: mins, mode: modeInput.value };
  await saveConfig(cfg);
  domainInput.value = '';
  modeInput.value = BLOCK_MODE.SMART;
  minsInput.value = String(DEFAULT_LIMIT_MINUTES);
  await render();
}

document.getElementById('add-btn').addEventListener('click', addDomain);

document.getElementById('refresh-ollama').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-ollama');
  btn.disabled = true;
  const config = await getConfig();
  await Promise.all([
    refreshInstalledModels(),
    refreshOllamaStatus(config.ollamaModel),
  ]);
  await render();
  btn.disabled = false;
});

document.getElementById('model-select').addEventListener('change', async (event) => {
  const select = event.currentTarget;
  const model = select.value.trim();
  const config = await getConfig();
  config.ollamaModel = model;
  await saveConfig(config);
  await refreshOllamaStatus(model);
  await render();
});

document.getElementById('clear-cache').addEventListener('click', async () => {
  const btn = document.getElementById('clear-cache');
  const status = document.getElementById('tools-status');
  btn.disabled = true;
  const result = await clearClassificationCache();
  status.textContent = result.ok ? `Cleared ${result.count}` : 'Clear failed';
  btn.disabled = false;
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn === tab));
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `${name}-panel`);
    });
  });
});

function onEnter(e) { if (e.key === 'Enter') addDomain(); }
domainInput.addEventListener('keydown', onEnter);
minsInput.addEventListener('keydown', onEnter);

render();
// Tick every second for a live counter; Ollama check is cached to every 15s.
setInterval(render, 1000);
