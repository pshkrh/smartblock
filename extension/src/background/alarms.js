import { POLL_INTERVAL_MINUTES } from '../shared/config.js';
import { localDateKey } from '../shared/date.js';
import { flushElapsed } from './timer.js';
import { resetToday, pruneCache, pruneHistory, getLastResetDay, setLastResetDay } from './storage.js';
import { unblockAll } from './blocker.js';

export const ALARM_POLL = 'poll';
export const ALARM_MIDNIGHT = 'midnight';

export function schedulePoll() {
  chrome.alarms.create(ALARM_POLL, { periodInMinutes: POLL_INTERVAL_MINUTES });
}

export function scheduleMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  chrome.alarms.create(ALARM_MIDNIGHT, { when: midnight.getTime() });
}

// Called once on install / startup to ensure alarms exist.
export async function initAlarms() {
  const [poll, mid] = await Promise.all([
    chrome.alarms.get(ALARM_POLL),
    chrome.alarms.get(ALARM_MIDNIGHT),
  ]);
  if (!poll) schedulePoll();
  if (!mid) scheduleMidnight();
}

export async function checkMissedReset() {
  const lastReset = await getLastResetDay();
  const today = localDateKey();
  if (lastReset && lastReset !== today) {
    await performReset();
  }
  await pruneHistory();
  await pruneCache();
}

export async function performReset() {
  await flushElapsed();
  await resetToday();
  await unblockAll();
  await pruneHistory();
  await pruneCache();
  scheduleMidnight(); // reschedule for next midnight
}
