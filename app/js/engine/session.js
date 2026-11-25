// Pure session logic: queue selection and per-answer bookkeeping. No DOM, no storage.
import { grade } from './grade.js';
import { review, isDue, isMastered } from './srs.js';
import { daysBetween, parseDay } from './time.js';
import { answerReward, sessionReward, capTokens } from '../rewards/economy.js';

export const DEFAULT_SIZES = { competition: 12, practice: 8, phonics: 5 };

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Spread difficulties: alternate from the easy and hard ends of a sorted list. */
function interleave(words) {
  const sorted = [...words].sort((x, y) => x.difficulty - y.difficulty);
  const out = [];
  while (sorted.length) {
    out.push(sorted.shift());
    if (sorted.length) out.push(sorted.pop());
  }
  return out;
}

/**
 * Choose the words for a session.
 * @param {{words:object[], progress:Map<string,object>, kind?:string, size?:number|'all',
 *          now?:number, beeDate?:string|null, newRatio?:number, rng?:()=>number}} o
 */
export function buildQueue({ words, progress, kind = 'practice', size = 8, now = Date.now(),
  beeDate = null, newRatio = 0.3, rng = Math.random }) {
  const p = (w) => progress.get(w.key);
  if (!words.length) return [];
  if (size === 'all' || size >= words.length && kind === 'stage') return shuffle(words, rng);

  const fixit = words.filter((w) => p(w)?.fixit).sort((a, b) => (p(a).lastSeen - p(b).lastSeen));
  if (kind === 'review') return fixit.slice(0, size);

  const bee = parseDay(beeDate);
  const daysToBee = Number.isFinite(bee) ? daysBetween(now, bee) : Infinity;
  const unseen = words.filter((w) => !p(w) || p(w).seen === 0);
  // Close to the bee, make sure every word gets seen: raise the share of new words.
  const ratio = daysToBee >= 0 && daysToBee <= 10 && unseen.length ? Math.max(newRatio, 0.5) : newRatio;

  const chosen = new Set();
  const take = (list, n) => {
    for (const w of list) {
      if (n <= 0 || chosen.size >= size) break;
      if (!chosen.has(w)) { chosen.add(w); n--; }
    }
  };
  take(fixit, Math.ceil(size / 2));
  const due = words.filter((w) => p(w)?.seen > 0 && !p(w).fixit && isDue(p(w), now))
    .sort((a, b) => p(a).due - p(b).due);
  const newCount = Math.max(1, Math.round(size * ratio));
  take(due, size - chosen.size - Math.min(newCount, unseen.length));
  take(shuffle(unseen, rng), newCount);
  take(due, size);                                   // more due words if new ran short
  take(shuffle(unseen, rng), size);                  // more new words if due ran short
  // Still short: the least-solid words that are not yet due (lowest box, soonest due).
  const rest = words.filter((w) => !chosen.has(w))
    .sort((a, b) => ((p(a)?.box ?? 0) - (p(b)?.box ?? 0)) || ((p(a)?.due ?? 0) - (p(b)?.due ?? 0)));
  take(rest, size);
  return interleave(shuffle([...chosen], rng));
}

/**
 * One study session. Everything here is synchronous so screens can speak inside the tap.
 * The caller persists `result.progress` and the reward entries.
 */
export class Session {
  constructor({ id, profileId, kind, words, progress, beeDate = null, rewardSettings = null,
    ledger = [], allowRetry = kind === 'practice', clock = () => Date.now() }) {
    this.id = id;
    this.profileId = profileId;
    this.kind = kind;
    this.words = words;
    this.progress = progress; // Map key -> record; updated in place with new records
    this.beeDate = beeDate;
    this.rewardSettings = rewardSettings;
    this.ledger = [...ledger];  // local view for cap math; new earn entries are appended
    this.allowRetry = allowRetry;
    this.clock = clock;
    this.index = 0;
    this.answers = [];          // counted answers
    this.tries = 0;             // tries on the current word
    this.totals = { xp: 0, coins: 0, tokens: 0, tokenCapped: false };
    this.newlyMastered = [];
    this.startedAt = clock();
  }

  get total() { return this.words.length; }
  current() { return this.words[this.index] ?? null; }
  canRetry() { return this.allowRetry && this.tries === 1 && this.lastResult && !this.lastResult.correct; }

  /** Earn tokens through the caps and record a local ledger entry. */
  earnTokens(want, reason) {
    const now = this.clock();
    const { granted, capped } = capTokens(want, this.ledger, this.profileId, this.rewardSettings, now);
    let entry = null;
    if (granted > 0) {
      entry = { id: `${this.id}:${reason}:${this.ledger.length}`, profileId: this.profileId, at: now,
        type: 'earn', tokens: granted, reason };
      this.ledger.push(entry);
    }
    if (capped) this.totals.tokenCapped = true;
    this.totals.tokens += granted;
    return { granted, capped, entry };
  }

  /** Mark the current word as assisted (the child peeked at the spelling). */
  peek() {
    if (this.current()) this.assisted = true;
  }

  /**
   * @param {string} letters
   * @param {{assisted?:boolean}} opts assisted = the child saw the word first (Peek).
   *   Assisted answers never count: no SRS move, no mastery token, retry-sized XP,
   *   and they are left out of the session's accuracy (so they earn no session tokens).
   */
  submit(letters, { assisted = false } = {}) {
    const word = this.current();
    if (!word) throw new Error('Session is finished');
    if (assisted) this.assisted = true;
    const now = this.clock();
    const g = grade(letters, word);
    const counted = this.tries === 0 && !this.assisted;
    this.tries++;
    let srs = null;
    if (counted) {
      srs = review(this.progress.get(word.key), {
        correct: g.correct, attempt: letters, sessionId: this.id, now, beeDate: this.beeDate,
      });
      srs.progress.key = word.key;
      this.progress.set(word.key, srs.progress);
      this.answers.push({ key: word.key, correct: g.correct, attempt: String(letters), at: now });
      if (srs.newlyMastered) this.newlyMastered.push(word.word);
    }
    const r = answerReward({
      correct: g.correct, counted,
      fixitCleared: !!srs?.fixitCleared, newlyMastered: !!srs?.newlyMastered,
    });
    const tok = this.earnTokens(r.tokens, `mastered:${word.key}`);
    this.totals.xp += r.xp;
    this.totals.coins += r.coins;
    const result = {
      ...g,
      counted,
      assisted: !!this.assisted,
      reward: { xp: r.xp, coins: r.coins, tokens: tok.granted, tokenCapped: tok.capped },
      ledgerEntries: tok.entry ? [tok.entry] : [],
      fixit: { added: !!srs?.fixitAdded, cleared: !!srs?.fixitCleared },
      progress: this.progress.get(word.key) ?? null,
    };
    this.lastResult = result;
    // A1: a miss that will be retried must not show the answer, or the retry is just copying.
    // The child sees which of THEIR letters were right; the target row is blanks of the same length.
    if (!g.correct && this.canRetry()) {
      result.revealed = false;
      result.target = null;
      result.targetMarks = g.targetMarks.map((m) => (m.sep ? { ...m } : { ch: '_', ok: m.ok }));
      result.patterns = [];
    } else {
      result.revealed = true;
    }
    return result;
  }

  /** Skip without answering: treated as a miss for scheduling, but no "wrong" message needed. */
  skip() {
    if (this.tries === 0) return this.submit('');
    return this.lastResult;
  }

  /** Number of counted answers so far (used to decide whether leaving early keeps rewards). */
  get answeredCount() { return this.answers.length; }

  next() {
    this.index++;
    this.tries = 0;
    this.assisted = false;
    this.lastResult = null;
    return this.current();
  }

  isDone() { return this.index >= this.words.length; }

  /** Session-level rewards. Returns {summary, ledgerEntries}. */
  finish() {
    const answered = this.answers.length;
    const correct = this.answers.filter((a) => a.correct).length;
    const sr = sessionReward({ answered, correct, kind: this.kind }, this.rewardSettings);
    const tok = this.earnTokens(sr.tokens, `session:${this.id}`);
    this.totals.xp += sr.xp;
    this.totals.coins += sr.coins;
    const fixitLeft = [...this.progress.values()].filter((p) => p.fixit).length;
    return {
      summary: {
        kind: this.kind, answered, correct,
        accuracy: answered ? correct / answered : 0,
        xp: this.totals.xp, coins: this.totals.coins,
        tokens: this.totals.tokens, tokenCapped: this.totals.tokenCapped,
        newlyMastered: [...this.newlyMastered], fixitLeft,
      },
      ledgerEntries: tok.entry ? [tok.entry] : [],
    };
  }
}

/** Readiness over a word set: share of words mastered. */
export function readiness(words, progress) {
  let mastered = 0; let seen = 0; let fixit = 0;
  for (const w of words) {
    const p = progress.get(w.key);
    if (!p) continue;
    if (p.seen > 0) seen++;
    if (p.fixit) fixit++;
    if (isMastered(p)) mastered++;
  }
  return { total: words.length, mastered, seen, fixit, pct: words.length ? mastered / words.length : 0 };
}

export function topMistakes(words, progress, n = 10) {
  const byKey = new Map(words.map((w) => [w.key, w]));
  return [...progress.values()]
    .filter((p) => p.wrong > 0 && byKey.has(p.key))
    .sort((a, b) => (b.wrong - a.wrong) || (b.lastSeen - a.lastSeen))
    .slice(0, n)
    .map((p) => {
      const word = byKey.get(p.key);
      const attempts = (p.misses ?? []).map((m) => m.attempt).filter(Boolean);
      // Patterns across the recent misses, most frequent first.
      const counts = new Map();
      for (const a of attempts) for (const pat of grade(a, word).patterns) counts.set(pat, (counts.get(pat) ?? 0) + 1);
      const patterns = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([pat]) => pat);
      return { word: word.word, key: p.key, wrong: p.wrong, correct: p.correct, fixit: p.fixit,
        lastAttempts: attempts, patterns };
    });
}
