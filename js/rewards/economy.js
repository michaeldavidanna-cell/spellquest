// Pure reward rules (T1 §5, T2 §5). Three separate currencies:
//   XP     -> levels, never spent
//   coins  -> cosmetics only, never real-world rewards
//   tokens -> real-world minutes (PS5 by default), granted by hand by a parent
import { startOfDay, startOfWeek, localDay, daysBetween, parseDay } from '../engine/time.js';

export const DEFAULT_REWARD_SETTINGS = Object.freeze({
  rewardName: 'PS5',
  minutesPerToken: 5,
  dailyEarnCap: 6,        // tokens per kid per day (6 x 5 = 30 min)
  weeklyEarnCap: null,    // optional
  hourlyEarnCap: 3,       // stops "farming" easy words
  dailyRedeemCap: null,   // optional, tokens per kid per day
  minSessionAnswers: 5,   // a session must have this many answers to earn tokens
  minPhonicsRounds: 4,
});

export function withDefaults(settings) {
  return { ...DEFAULT_REWARD_SETTINGS, ...(settings ?? {}) };
}

// ---- XP and coins -------------------------------------------------------

export function answerReward({ correct, counted = true, fixitCleared = false, newlyMastered = false }) {
  let xp;
  let coins;
  if (correct && counted) { xp = 10; coins = 5; }
  else if (correct) { xp = 5; coins = 2; }       // got it on the retry
  else { xp = 3; coins = 1; }                     // a good try still counts
  if (fixitCleared) { xp += 15; coins += 5; }
  return { xp, coins, tokens: newlyMastered ? 1 : 0 };
}

export function sessionReward({ answered, correct, kind = 'practice' }, settings) {
  const s = withDefaults(settings);
  const min = kind === 'phonics' ? s.minPhonicsRounds : s.minSessionAnswers;
  if (answered <= 0) return { xp: 0, coins: 0, tokens: 0 };
  const accuracy = correct / answered;
  const finished = answered >= min;
  return {
    xp: finished ? 20 : 5,
    coins: finished ? 10 : 2,
    tokens: finished ? (accuracy >= 0.8 ? 2 : 1) : 0,
  };
}

/** XP needed to reach a level: L1=0, L2=100, L3=300, L4=600 ... */
export function xpForLevel(level) {
  return 50 * (level - 1) * level;
}

export function levelForXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  return { level, progress: (xp - lo) / (hi - lo), nextAt: hi };
}

// ---- Streaks ------------------------------------------------------------

/** Call when a session finishes. Returns new streak and whether a 3-day bonus is due. */
export function updateStreak(streak, now = Date.now()) {
  const today = localDay(now);
  const prev = streak ?? { count: 0, lastDay: null };
  if (prev.lastDay === today) return { streak: prev, extended: false, bonusTokens: 0 };
  const gap = prev.lastDay ? daysBetween(parseDay(prev.lastDay), now) : Infinity;
  const count = gap === 1 ? prev.count + 1 : 1;
  return {
    streak: { count, lastDay: today },
    extended: true,
    bonusTokens: count > 0 && count % 3 === 0 ? 1 : 0,
  };
}

// ---- Token ledger -------------------------------------------------------
// Entry = { id, profileId, at, type: 'earn'|'adjust'|'redeem', tokens (>0, adjust may be <0),
//           reason, status?: 'pending'|'added'|'declined', minutes?, resolvedAt? }

export function tokenBalance(ledger, profileId) {
  let total = 0;
  for (const e of ledger) {
    if (e.profileId !== profileId) continue;
    if (e.type === 'earn' || e.type === 'adjust') total += e.tokens;
    else if (e.type === 'redeem' && e.status !== 'declined') total -= e.tokens;
  }
  return Math.max(0, total);
}

function earnedSince(ledger, profileId, since) {
  let n = 0;
  for (const e of ledger) if (e.profileId === profileId && e.type === 'earn' && e.at >= since) n += e.tokens;
  return n;
}

export function earnedToday(ledger, profileId, now = Date.now()) {
  return earnedSince(ledger, profileId, startOfDay(now));
}

/** How many of `want` tokens may be granted now, given the caps. */
export function capTokens(want, ledger, profileId, settings, now = Date.now()) {
  const s = withDefaults(settings);
  if (want <= 0) return { granted: 0, capped: false };
  let room = Infinity;
  if (s.dailyEarnCap != null) room = Math.min(room, s.dailyEarnCap - earnedSince(ledger, profileId, startOfDay(now)));
  if (s.weeklyEarnCap != null) room = Math.min(room, s.weeklyEarnCap - earnedSince(ledger, profileId, startOfWeek(now)));
  if (s.hourlyEarnCap != null) room = Math.min(room, s.hourlyEarnCap - earnedSince(ledger, profileId, now - 3_600_000));
  room = Math.max(0, room);
  const granted = Math.min(want, room);
  return { granted, capped: granted < want };
}

export function redeemedToday(ledger, profileId, now = Date.now()) {
  const since = startOfDay(now);
  let n = 0;
  for (const e of ledger) {
    if (e.profileId === profileId && e.type === 'redeem' && e.status !== 'declined' && e.at >= since) n += e.tokens;
  }
  return n;
}

export function checkCashIn(tokens, ledger, profileId, settings, now = Date.now()) {
  const s = withDefaults(settings);
  if (!Number.isInteger(tokens) || tokens <= 0) return { ok: false, reason: 'invalid-amount' };
  if (tokens > tokenBalance(ledger, profileId)) return { ok: false, reason: 'not-enough-tokens' };
  if (s.dailyRedeemCap != null && redeemedToday(ledger, profileId, now) + tokens > s.dailyRedeemCap) {
    return { ok: false, reason: 'daily-redeem-cap' };
  }
  return { ok: true, minutes: tokens * s.minutesPerToken };
}

export function pendingCards(ledger, profileId = null) {
  return ledger
    .filter((e) => e.type === 'redeem' && e.status === 'pending' && (!profileId || e.profileId === profileId))
    .sort((a, b) => a.at - b.at);
}

/** Parent instructions for a pending card (T2 §5). No PlayStation API is used. */
export function ps5Steps(card, profileName = 'your child') {
  return [
    'Open the PlayStation Family app.',
    `Select ${profileName}.`,
    `Playtime → add ${card.minutes} minutes for today. (If ${profileName} tapped "Ask for More Playtime" on the PS5, approve ${card.minutes} minutes on that notification instead.)`,
    'Come back here and tap "I added it".',
  ];
}
