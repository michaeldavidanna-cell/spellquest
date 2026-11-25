// Pure Leitner scheduling with bee-date compression (T1 §4).
import { addDays, daysBetween, parseDay } from './time.js';

/** Days until next review for boxes 0..5. */
export const BOX_INTERVALS = [0, 1, 2, 4, 7, 14];
export const MAX_BOX = BOX_INTERVALS.length - 1;
export const MASTERED_BOX = 4;
/** A Fix-It word must be spelled right in this many separate sessions to leave the list. */
export const FIXIT_CLEAR_SESSIONS = 2;
const MAX_MISSES_KEPT = 5;

export function newProgress(key) {
  return {
    key, box: 0, due: 0, seen: 0, correct: 0, wrong: 0, streak: 0,
    lastSeen: 0, fixit: false, fixitSessions: [], misses: [],
  };
}

/**
 * Interval in days for a box, capped so every word gets about 3 reps
 * before the bee: cap = max(1, floor(daysToBee / 3)) while the bee is ahead.
 */
export function intervalDays(box, { now = Date.now(), beeDate = null } = {}) {
  const base = BOX_INTERVALS[Math.max(0, Math.min(MAX_BOX, box))];
  const bee = parseDay(beeDate);
  if (!Number.isFinite(bee) || base === 0) return base;
  const daysToBee = daysBetween(now, bee);
  if (daysToBee < 0) return base; // bee is over: normal schedule
  const cap = Math.max(1, Math.floor(daysToBee / 3));
  return Math.min(base, cap);
}

export function isDue(p, now = Date.now()) {
  return !p || p.seen === 0 || p.due <= now;
}

export function isMastered(p) {
  return !!p && p.box >= MASTERED_BOX && !p.fixit;
}

/**
 * Apply one counted answer. Returns a NEW progress record plus flags.
 * @param {object} p existing progress (or null)
 * @param {{correct:boolean, attempt?:string, sessionId:string, now?:number, beeDate?:string|null}} a
 */
export function review(p, { correct, attempt = '', sessionId, now = Date.now(), beeDate = null }) {
  const prev = p ?? newProgress(undefined);
  const next = {
    ...prev,
    fixitSessions: [...(prev.fixitSessions ?? [])],
    misses: [...(prev.misses ?? [])],
    seen: prev.seen + 1,
    lastSeen: now,
  };
  const wasMastered = isMastered(prev);
  let fixitAdded = false;
  let fixitCleared = false;

  if (correct) {
    next.correct = prev.correct + 1;
    next.streak = prev.streak + 1;
    next.box = Math.min(MAX_BOX, prev.box + 1);
    if (next.fixit && sessionId && !next.fixitSessions.includes(sessionId)) {
      next.fixitSessions.push(sessionId);
      if (next.fixitSessions.length >= FIXIT_CLEAR_SESSIONS) {
        next.fixit = false;
        next.fixitSessions = [];
        fixitCleared = true;
      }
    }
  } else {
    next.wrong = prev.wrong + 1;
    next.streak = 0;
    next.box = 1;
    fixitAdded = !prev.fixit;
    next.fixit = true;
    next.fixitSessions = [];
    next.misses.push({ at: now, attempt: String(attempt) });
    if (next.misses.length > MAX_MISSES_KEPT) next.misses = next.misses.slice(-MAX_MISSES_KEPT);
  }
  // Wrong answers come back the next day (Fix-It also surfaces them); never later than the bee.
  const days = correct ? intervalDays(next.box, { now, beeDate }) : 1;
  next.due = addDays(now, days);

  return {
    progress: next,
    fixitAdded,
    fixitCleared,
    newlyMastered: !wasMastered && isMastered(next),
  };
}
