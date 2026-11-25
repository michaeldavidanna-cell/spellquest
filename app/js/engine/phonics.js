// Pure phonics mini-mode for the 5-year-old: letters, first sounds, CVC words.
// No fail state: after 2 misses the answer is revealed and celebrated.
import { review } from './srs.js';
import { answerReward, sessionReward, capTokens } from '../rewards/economy.js';

// picture words chosen to start with the plain (short) sound of the letter.
export const LETTERS = [
  ['a', 'apple', '🍎'], ['b', 'ball', '⚽'], ['c', 'cat', '🐱'], ['d', 'dog', '🐶'],
  ['e', 'egg', '🥚'], ['f', 'fish', '🐟'], ['g', 'goat', '🐐'], ['h', 'hat', '🎩'],
  ['i', 'insect', '🐞'], ['j', 'jam', '🍓'], ['k', 'kite', '🪁'], ['l', 'leaf', '🍃'],
  ['m', 'moon', '🌙'], ['n', 'nest', '🪺'], ['o', 'octopus', '🐙'], ['p', 'pig', '🐷'],
  ['q', 'queen', '👑'], ['r', 'rabbit', '🐰'], ['s', 'sun', '☀️'], ['t', 'tent', '⛺'],
  ['u', 'umbrella', '☂️'], ['v', 'van', '🚐'], ['w', 'worm', '🪱'], ['x', 'fox', '🦊'],
  ['y', 'yo-yo', '🪀'], ['z', 'zebra', '🦓'],
].map(([letter, picture, emoji]) => ({ letter, picture, emoji }));

export const CVC_WORDS = ['cat', 'dog', 'sun', 'pig', 'hat', 'bed', 'fox', 'bug', 'map', 'net',
  'cup', 'fin', 'log', 'jam', 'web', 'bus', 'pen', 'rod', 'mud', 'van', 'fan', 'hop', 'sit', 'red'];

// letters children commonly mix up, used as decoys
const CONFUSABLE = { b: 'dpq', d: 'bpq', p: 'bdq', q: 'pgb', m: 'nw', n: 'mh', w: 'mv', u: 'nv',
  e: 'ia', i: 'el', a: 'eo', o: 'ac', c: 'ok', k: 'cx', s: 'zc', z: 'sx', f: 'tv', v: 'fw', g: 'qj', j: 'gi' };

const KEY = (type, v) => `ph:${type}:${v}`;

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function decoys(letter, n, rng) {
  const pool = [...(CONFUSABLE[letter] ?? '')].concat(shuffle(LETTERS.map((l) => l.letter), rng));
  const out = [];
  for (const c of pool) if (c !== letter && !out.includes(c) && out.length < n) out.push(c);
  return out;
}

export function letterInfo(letter) {
  return LETTERS.find((l) => l.letter === letter) ?? null;
}

/** Text the speech module says for a letter when no recording exists. */
export function phonicsSayAs(letter) {
  const info = letterInfo(letter);
  return info ? `${letter}. ${letter}, as in ${info.picture}.` : letter;
}

/** Build `rounds` rounds, weighting letters/words the child has missed. */
export function buildPhonicsRounds({ rounds = 5, progress = new Map(), rng = Math.random, includeWords = true }) {
  const weight = (key) => { const p = progress.get(key); return p ? (p.fixit ? 3 : p.box >= 4 ? 0.5 : 1) : 1.5; };
  const weighted = (items, keyFn) => {
    const total = items.reduce((s, it) => s + weight(keyFn(it)), 0);
    let r = rng() * total;
    for (const it of items) { r -= weight(keyFn(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  };
  const out = [];
  const used = new Set();
  for (let i = 0; i < rounds; i++) {
    const type = includeWords && i === rounds - 1 ? 'build' : (i % 2 === 0 ? 'find-letter' : 'first-sound');
    if (type === 'build') {
      let word = weighted(CVC_WORDS, (w) => KEY('word', w));
      if (used.has(word)) word = pick(CVC_WORDS.filter((w) => !used.has(w)), rng);
      used.add(word);
      const extra = decoys(word[0], 2, rng).filter((c) => !word.includes(c));
      out.push({ type, key: KEY('word', word), word, tiles: shuffle([...word, ...extra], rng) });
    } else {
      // 'x' only ends words a 5-year-old knows (fox), so it is skipped for first-sound rounds.
      const pool = type === 'first-sound' ? LETTERS.filter((l) => l.letter !== 'x') : LETTERS;
      let info = weighted(pool, (l) => KEY('letter', l.letter));
      if (used.has(info.letter)) info = pick(pool.filter((l) => !used.has(l.letter)), rng);
      used.add(info.letter);
      const choices = shuffle([info.letter, ...decoys(info.letter, 2, rng)], rng);
      out.push(type === 'find-letter'
        ? { type, key: KEY('letter', info.letter), letter: info.letter, choices, sayAs: phonicsSayAs(info.letter) }
        : { type, key: KEY('letter', info.letter), letter: info.letter, picture: info.picture, emoji: info.emoji, choices });
    }
  }
  return out;
}

export class PhonicsSession {
  constructor({ id, profileId, rounds, progress, rewardSettings = null, ledger = [], clock = () => Date.now() }) {
    Object.assign(this, { id, profileId, rounds, progress, rewardSettings, clock });
    this.ledger = [...ledger];
    this.index = 0;
    this.tries = 0;
    this.built = [];      // letters placed so far in a 'build' round
    this.answers = [];
    this.totals = { xp: 0, coins: 0, tokens: 0, tokenCapped: false };
  }

  get total() { return this.rounds.length; }
  current() { return this.rounds[this.index] ?? null; }
  isDone() { return this.index >= this.rounds.length; }

  /**
   * find-letter / first-sound: pass the tapped letter.
   * build: pass the full word built so far (string); graded when it reaches the word length.
   */
  answer(input) {
    const r = this.current();
    if (!r) throw new Error('Phonics session is finished');
    const target = r.type === 'build' ? r.word : r.letter;
    const given = String(input ?? '').toLowerCase();
    if (r.type === 'build' && given.length < target.length) {
      return { correct: target.startsWith(given), partial: true, tries: this.tries, reveal: false };
    }
    const correct = given === target;
    const counted = this.tries === 0;
    this.tries++;
    if (counted) {
      const s = review(this.progress.get(r.key), { correct, attempt: given, sessionId: this.id, now: this.clock() });
      s.progress.key = r.key;
      this.progress.set(r.key, s.progress);
      this.answers.push({ key: r.key, correct });
    }
    const rw = answerReward({ correct, counted });
    this.totals.xp += rw.xp;
    this.totals.coins += rw.coins;
    return { correct, partial: false, tries: this.tries, reveal: !correct && this.tries >= 2, answer: target,
      reward: { xp: rw.xp, coins: rw.coins, tokens: 0 }, progress: this.progress.get(r.key) };
  }

  next() { this.index++; this.tries = 0; return this.current(); }

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

  finish() {
    const answered = this.answers.length;
    const correct = this.answers.filter((a) => a.correct).length;
    const sr = sessionReward({ answered, correct, kind: 'phonics' }, this.rewardSettings);
    const tok = this.earnTokens(sr.tokens, `session:${this.id}`);
    this.totals.xp += sr.xp;
    this.totals.coins += sr.coins;
    return {
      summary: { kind: 'phonics', answered, correct, accuracy: answered ? correct / answered : 0,
        ...this.totals, newlyMastered: [], fixitLeft: 0 },
      ledgerEntries: tok.entry ? [tok.entry] : [],
    };
  }
}
