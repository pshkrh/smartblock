import { VERDICT } from './rules.js';
import {
  addActivityMs, addMs, isOverLimit, getLimitMs, getUsage, getConfig,
  getSession, setActiveSessions, setCurrentTab,
} from './storage.js';

let onLimitReached = null;
let mutationQueue = Promise.resolve();
export function setLimitReachedCallback(cb) { onLimitReached = cb; }

function serializeMutation(fn) {
  const run = mutationQueue.then(fn, fn);
  mutationQueue = run.catch(() => {});
  return run;
}

function uniqueDomains(sessions) {
  return [...new Set(sessions.map(session => session.domain))];
}

function uniqueActivityIds(sessions) {
  return [...new Set(sessions.map(session => session.activityId).filter(Boolean))];
}

async function scheduleBlockAlarm(domain) {
  const [usage, limitMs] = await Promise.all([getUsage(domain), getLimitMs(domain)]);
  const effectiveLimit = limitMs + (usage.extraMs ?? 0);
  const remainingMs = effectiveLimit - usage.ms;
  if (remainingMs > 0) {
    chrome.alarms.create(`block_${domain}`, { when: Date.now() + remainingMs });
  } else {
    chrome.alarms.clear(`block_${domain}`);
  }
}

async function refreshDomainAlarms(sessions) {
  const domains = uniqueDomains(sessions);
  for (const domain of domains) {
    const hasRunningSession = sessions.some(session => session.domain === domain && !session.paused);
    if (hasRunningSession) {
      await scheduleBlockAlarm(domain);
    } else {
      chrome.alarms.clear(`block_${domain}`);
    }
  }
}

async function replaceSessions(nextSessions, previousSessions = []) {
  await setActiveSessions(nextSessions);
  const clearedDomains = uniqueDomains(previousSessions).filter(
    domain => !nextSessions.some(session => session.domain === domain)
  );
  for (const domain of clearedDomains) {
    chrome.alarms.clear(`block_${domain}`);
  }
  await refreshDomainAlarms(nextSessions);
}

async function sessionTabExists(session) {
  try {
    const tab = await chrome.tabs.get(session.tabId);
    return tab.windowId === session.windowId;
  } catch {
    return false;
  }
}

async function pruneMissingSessionsUnlocked() {
  const { activeSessions } = await getSession();
  if (!activeSessions.length) return [];

  const checks = await Promise.all(activeSessions.map(sessionTabExists));
  const liveSessions = activeSessions.filter((_session, index) => checks[index]);
  if (liveSessions.length !== activeSessions.length) {
    await replaceSessions(liveSessions, activeSessions);
  }
  return liveSessions;
}

export function pruneMissingSessions() {
  return serializeMutation(pruneMissingSessionsUnlocked);
}

async function flushElapsedUnlocked({ pruneMissing = true } = {}) {
  const { activeSessions: storedSessions } = await getSession();
  if (!storedSessions.length) return;

  const activeSessions = pruneMissing
    ? await pruneMissingSessionsUnlocked()
    : storedSessions;

  if (!activeSessions.length) return;

  const nextSessions = [];
  const usageCache = new Map();
  const limitCache = new Map();
  const domainGroups = new Map();
  const now = Date.now();

  for (const session of activeSessions) {
    if (session.paused) {
      nextSessions.push(session);
      continue;
    }

    const elapsed = now - session.startTs;
    if (elapsed <= 0) {
      nextSessions.push(session);
      continue;
    }

    nextSessions.push({ ...session, startTs: now });

    const group = domainGroups.get(session.domain) ?? { elapsed: 0, sessions: [] };
    group.elapsed = Math.max(group.elapsed, elapsed);
    group.sessions.push(session);
    domainGroups.set(session.domain, group);
  }

  for (const [domain, group] of domainGroups.entries()) {
    let current = usageCache.get(domain);
    if (!current) {
      current = await getUsage(domain);
      usageCache.set(domain, current);
    }

    let limitMs = limitCache.get(domain);
    if (!limitMs) {
      limitMs = await getLimitMs(domain);
      limitCache.set(domain, limitMs);
    }

    const effectiveLimit = limitMs + (current.extraMs ?? 0);
    const remaining = Math.max(0, effectiveLimit - current.ms);
    const banked = Math.min(group.elapsed, remaining);

    if (banked > 0) {
      const usage = await addMs(domain, banked);
      usageCache.set(domain, usage);
      const activityIds = uniqueActivityIds(group.sessions);
      const perActivityMs = activityIds.length > 0 ? banked / activityIds.length : 0;
      for (const activityId of activityIds) {
        await addActivityMs(activityId, perActivityMs);
      }
      if (usage.ms >= effectiveLimit && onLimitReached) {
        onLimitReached(domain);
      }
    } else if (current.ms >= effectiveLimit && onLimitReached) {
      onLimitReached(domain);
    }
  }

  await setActiveSessions(nextSessions);
}

export function flushElapsed(options = {}) {
  return serializeMutation(() => flushElapsedUnlocked(options));
}

export async function onVerdictChanged({ tabId, windowId, domain, verdict, url, activityId, mode }) {
  const tabData = { tabId, windowId, domain, verdict, url, activityId, mode };
  return serializeMutation(async () => {
    await flushElapsedUnlocked();
    const { activeSessions: flushedSessions } = await getSession();
    await setCurrentTab(tabData);

    if (verdict === VERDICT.ENTERTAINMENT) {
      const config = await getConfig();
      if (!config.domains[domain]) {
        const nextSessions = flushedSessions.filter(session => session.windowId !== windowId);
        await replaceSessions(nextSessions, flushedSessions);
        return;
      }

      const overLimit = await isOverLimit(domain);
      if (overLimit) {
        const nextSessions = flushedSessions.filter(session => session.windowId !== windowId);
        await replaceSessions(nextSessions, flushedSessions);
        if (onLimitReached) onLimitReached(domain);
        return;
      }

      const nextSession = { domain, tabId, windowId, startTs: Date.now(), activityId, mode };
      const nextSessions = [
        ...flushedSessions.filter(session => session.windowId !== windowId),
        nextSession,
      ];
      await replaceSessions(nextSessions, flushedSessions);
      return;
    }

    const nextSessions = flushedSessions.filter(session => session.windowId !== windowId);
    await replaceSessions(nextSessions, flushedSessions);
  });
}

export async function onWindowBlurred() {
  return serializeMutation(async () => {
    const { activeSessions } = await getSession();
    if (!activeSessions.length) return;
    await flushElapsedUnlocked();
    const { activeSessions: flushedSessions } = await getSession();
    await replaceSessions([], flushedSessions);
  });
}

export async function pauseSession(tabId, windowId) {
  return serializeMutation(async () => {
    await flushElapsedUnlocked();
    const { activeSessions } = await getSession();
    let changed = false;
    const nextSessions = activeSessions.map(session => {
      if (session.tabId === tabId && session.windowId === windowId && !session.paused) {
        changed = true;
        return { ...session, paused: true };
      }
      return session;
    });
    if (changed) await replaceSessions(nextSessions, activeSessions);
  });
}

export async function resumeSession(tabId, windowId) {
  return serializeMutation(async () => {
    const { activeSessions } = await getSession();
    let changed = false;
    const nextSessions = activeSessions.map(session => {
      if (session.tabId === tabId && session.windowId === windowId && session.paused) {
        changed = true;
        return { ...session, paused: false, startTs: Date.now() };
      }
      return session;
    });
    if (changed) await replaceSessions(nextSessions, activeSessions);
  });
}

export async function stopSessionByTab(tabId) {
  return serializeMutation(async () => {
    await flushElapsedUnlocked({ pruneMissing: false });
    const { activeSessions } = await getSession();
    const nextSessions = activeSessions.filter(session => session.tabId !== tabId);
    if (nextSessions.length !== activeSessions.length) {
      await replaceSessions(nextSessions, activeSessions);
    }
  });
}

export async function stopSessionsByWindow(windowId) {
  return serializeMutation(async () => {
    await flushElapsedUnlocked({ pruneMissing: false });
    const { activeSessions } = await getSession();
    const nextSessions = activeSessions.filter(session => session.windowId !== windowId);
    if (nextSessions.length !== activeSessions.length) {
      await replaceSessions(nextSessions, activeSessions);
    }
  });
}

export async function stopSessionsByDomain(domain) {
  return serializeMutation(async () => {
    await flushElapsedUnlocked({ pruneMissing: false });
    const { activeSessions } = await getSession();
    const nextSessions = activeSessions.filter(session => session.domain !== domain);
    if (nextSessions.length !== activeSessions.length) {
      await replaceSessions(nextSessions, activeSessions);
    }
  });
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
