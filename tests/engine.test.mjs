import test from 'node:test';
import assert from 'node:assert/strict';
import { newProgress, review, isMastered, intervalDays } from '../app/js/engine/srs.js';
import { grade } from '../app/js/engine/grade.js';
import { buildQueue, Session } from '../app/js/engine/session.js';
import { answerReward, sessionReward, levelForXp, capTokens, checkCashIn } from '../app/js/rewards/economy.js';

test('SRS advances correct answers and sends misses to Fix-It', () => {
  const first = review(null, { correct: true, sessionId: 's1', now: 1_000_000 });
  assert.equal(first.progress.box, 1);
  assert.ok(first.progress.due > 1_000_000);
  assert.ok(first.progress.due <= 1_000_000 + 86_400_000);
  const miss = review(first.progress, { correct: false, attempt: 'wird', sessionId: 's2', now: 2_000_000 });
  assert.equal(miss.progress.fixit, true);
  assert.equal(miss.progress.box, 1);
  assert.equal(miss.progress.misses[0].attempt, 'wird');
});

test('SRS clears Fix-It only after correct answers in separate sessions', () => {
  const missed = review(null, { correct: false, attempt: 'wrng', sessionId: 's0', now: 1 });
  const one = review(missed.progress, { correct: true, sessionId: 's1', now: 2 });
  assert.equal(one.progress.fixit, true);
  const repeated = review(one.progress, { correct: true, sessionId: 's1', now: 3 });
  assert.equal(repeated.progress.fixit, true);
  const two = review(repeated.progress, { correct: true, sessionId: 's2', now: 4 });
  assert.equal(two.fixitCleared, true);
  assert.equal(two.progress.fixit, false);
  assert.equal(isMastered(two.progress), true);
  assert.equal(intervalDays(4, { now: Date.UTC(2026, 0, 1), beeDate: '2026-01-07' }), 2);
});

test('grader accepts listed alternate forms and ignores separators and case', () => {
  const word = { word: 'fertilizer', accept: ['fertiliser'] };
  assert.equal(grade('FERTILISER', word).correct, true);
  assert.equal(grade('Sierra-Leone', { word: 'Sierra Leone' }).correct, true);
  assert.equal(grade('Gloucseter', { word: 'Gloucester' }).correct, false);
});

test('queue includes Fix-It words first when building a review session', () => {
  const words = [{ key: 'a', word: 'apple', difficulty: 1 }, { key: 'b', word: 'berry', difficulty: 2 }];
  const progress = new Map([['a', { ...newProgress('a'), fixit: true, lastSeen: 10 }]]);
  assert.deepEqual(buildQueue({ words, progress, kind: 'review', size: 2 }), [words[0]]);
});

test('session counts one first attempt, supports retry, and summarizes completion', () => {
  let now = 10_000;
  const word = { key: 'w', word: 'rhythm', accept: [], difficulty: 1 };
  const progress = new Map();
  const session = new Session({ id: 's', profileId: 'kid', kind: 'practice', words: [word], progress,
    clock: () => now++, rewardSettings: { hourlyEarnCap: 3 } });
  assert.equal(session.submit('rythm').counted, true);
  assert.equal(session.submit('rhythm').counted, false);
  assert.equal(session.answeredCount, 1);
  session.next();
  assert.equal(session.isDone(), true);
  const { summary } = session.finish();
  assert.equal(summary.answered, 1);
  assert.equal(summary.correct, 0);
  assert.equal(summary.xp, 13); // miss, retry, and short-session XP
});

test('economy applies answer, session, level, token cap, and cash-in rules', () => {
  assert.deepEqual(answerReward({ correct: true }), { xp: 10, coins: 5, tokens: 0 });
  assert.deepEqual(sessionReward({ answered: 5, correct: 4 }, {}), { xp: 20, coins: 10, tokens: 2 });
  assert.equal(levelForXp(300).level, 3);
  const now = Date.UTC(2026, 4, 10, 12);
  const ledger = [{ profileId: 'kid', type: 'earn', tokens: 2, at: now - 1000 }];
  assert.deepEqual(capTokens(3, ledger, 'kid', { dailyEarnCap: 3, hourlyEarnCap: null }, now), { granted: 1, capped: true });
  assert.deepEqual(checkCashIn(1, ledger, 'kid', { minutesPerToken: 5 }, now), { ok: true, minutes: 5 });
  assert.equal(checkCashIn(3, ledger, 'kid', {}, now).reason, 'not-enough-tokens');
});
