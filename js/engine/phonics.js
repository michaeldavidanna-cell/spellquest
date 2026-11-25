// Pure phonics mini-mode for the 5-year-old.
// A1: a level ladder from data/phonics.json (letter names -> letter sounds -> rhyming ->
// CVC words -> digraphs -> blends -> Dolch sight words -> two-word phrases) that advances
// on mastery, with spaced review of earlier levels so there is always something to play.
// No fail state: after 2 misses the answer is revealed and celebrated.
import { review, isDue } from './srs.js';
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

// ---- A1 level ladder ---------------------------------------------------------

export const PHONICS_SCHEMA = 'spellingbee.phonics/1';
/** Round types every phonics screen understands (B2). */
export const LEGACY_TYPES = ['find-letter', 'first-sound', 'build'];
/** All round types the engine can produce. Screens opt in to the new ones (see API.md). */
export const PHONICS_TYPES = [...LEGACY_TYPES, 'choose', 'build-phrase'];
const KNOWN_RATIO = 0.8;
const TEST_OUT = 8;

const LEVEL_NEEDS = {               // round types a level needs to be playable
  'letter-name': ['find-letter'], 'letter-sound': ['find-letter', 'first-sound'], rhyme: ['choose'],
  build: ['build'], sight: ['build'], phrase: ['build-phrase'],
};
const LADDER_KEY = (level, item) => `ph:${level}:${item}`;

/** Validate and index data/phonics.json. Returns null if it is not a phonics file. */
export function parseLadder(raw) {
  if (!raw || raw.schema !== PHONICS_SCHEMA || !Array.isArray(raw.levels)) return null;
  const knownRatio = Number(raw.mastery?.knownRatio) || KNOWN_RATIO;
  const testOut = Number(raw.mastery?.testOut) || TEST_OUT;
  const levels = raw.levels.filter((l) => l && l.id && LEVEL_NEEDS[l.kind] && Array.isArray(l.items) && l.items.length)
    .map((l, index) => ({
      id: String(l.id), title: String(l.title || l.id), emoji: l.emoji || null, kind: l.kind, index,
      families: l.families ?? null,
      items: l.items.map((it) => ({ ...it, id: String(it.id), key: LADDER_KEY(l.id, it.id) })),
    }));
  return levels.length ? { levels, knownRatio, testOut } : null;
}

function playable(level, types) {
  return LEVEL_NEEDS[level.kind].every((t) => types.includes(t));
}

export function itemKnown(p) {
  return !!p && p.correct >= 1 && p.streak >= 1;
}

/**
 * Where the child is on the ladder, derived from progress only (nothing extra is stored).
 * A level is mastered when 80% of its items are known (last answer right), or when the
 * first 8 items she met were all right first time ("tested out": too easy, move on).
 */
export function ladderStatus(ladder, progress, { types = LEGACY_TYPES } = {}) {
  const levels = ladder.levels.map((l) => {
    const recs = l.items.map((it) => progress.get(it.key));
    const seen = recs.filter((p) => p && p.seen > 0);
    const known = recs.filter(itemKnown).length;
    const testedOut = seen.length >= Math.min(ladder.testOut, l.items.length) && seen.every((p) => p.wrong === 0);
    const mastered = known >= Math.ceil(ladder.knownRatio * l.items.length) || testedOut;
    return { id: l.id, title: l.title, emoji: l.emoji, index: l.index, total: l.items.length, seen: seen.length,
      known, mastered, testedOut, playable: playable(l, types) };
  });
  const open = levels.filter((l) => l.playable);
  const cur = open.find((l) => !l.mastered) ?? open[open.length - 1] ?? null;
  return { levels, current: cur?.id ?? null, currentIndex: cur ? open.indexOf(cur) : -1, allMastered: open.every((l) => l.mastered) };
}

const SPEAK_CASE = { upper: 'capital', lower: 'small' };

function letterChoices(letter, rng, n = 2) {
  return shuffle([letter, ...decoys(letter, n, rng)], rng);
}

function wordTiles(word, rng, extra = 2) {
  const letters = [...String(word).toLowerCase().replace(/[^a-z]/g, '')];
  const pool = shuffle([...'aeiousmtpnbdglrfhck'].filter((c) => !letters.includes(c)), rng).slice(0, extra);
  return shuffle([...letters, ...pool], rng);
}

/** Build one round from a ladder item (pure). */
export function roundForItem(level, item, { progress = new Map(), rng = Math.random, types = LEGACY_TYPES, pools = {} } = {}) {
  const p = progress.get(item.key);
  const base = { key: item.key, itemId: item.id,
    level: level.index + 1, levelId: level.id, levelTitle: level.title, levelEmoji: level.emoji ?? null };
  const showWord = !itemKnown(p); // show the word to copy until she has built it right once; then build from sound + picture
  switch (level.kind) {
    case 'letter-name': {
      const up = item.case === 'upper';
      const disp = (c) => (up ? c.toUpperCase() : c);
      const choices = letterChoices(item.letter, rng);
      const say = `Find the ${SPEAK_CASE[item.case] ?? ''} letter ${item.letter.toUpperCase()}.`.replace('  ', ' ');
      return { ...base, type: 'find-letter', mode: 'name', letter: item.letter, case: item.case, display: disp(item.letter),
        choices: choices.map(disp), say, sayAs: say };
    }
    case 'letter-sound': {
      if (item.mode === 'picture') {
        return { ...base, type: 'first-sound', mode: 'picture', letter: item.letter, picture: item.picture, emoji: item.emoji ?? null,
          choices: letterChoices(item.letter, rng), say: `${item.picture}. What letter starts ${item.picture}?` };
      }
      return { ...base, type: 'find-letter', mode: 'sound', letter: item.letter, choices: letterChoices(item.letter, rng),
        sayAs: phonicsSayAs(item.letter), say: `Which letter says ${item.letter}?` };
    }
    case 'rhyme': {
      const fam = level.families?.[item.family] ?? [];
      const partners = level.items.filter((o) => o.family === item.family && o.id !== item.id);
      const right = partners.length ? pick(partners, rng) : item;
      const others = shuffle(level.items.filter((o) => o.family !== item.family && !fam.includes(o.word)), rng);
      const wrong = [];
      for (const o of others) { if (wrong.length >= 2) break; if (!wrong.some((w) => w.family === o.family)) wrong.push(o); }
      const choice = (o) => ({ id: o.id, value: o.id, label: o.word, word: o.word, emoji: o.emoji ?? null, say: o.word });
      return { ...base, type: 'choose', mode: 'rhyme', target: { label: item.word, emoji: item.emoji ?? null, say: item.word },
        word: item.word, emoji: item.emoji ?? null, title: `Which word rhymes with "${item.word}"?`,
        prompt: `Which one rhymes with ${item.word}?`, say: `Which one rhymes with ${item.word}?`,
        choices: shuffle([right, ...wrong], rng).map(choice), answer: right.id };
    }
    case 'build':
      return { ...base, type: 'build', mode: level.id, word: item.word, picture: item.word, emoji: item.emoji ?? null,
        tiles: wordTiles(item.word, rng), chunks: item.chunks ?? null, digraph: item.digraph ?? null,
        showWord, say: `Let's build ${item.word}!` };
    case 'sight': {
      // Recognise it first (tap the word among 3), then spell it once she knows it.
      if (types.includes('choose') && !itemKnown(p)) {
        const others = shuffle((pools.sight ?? level.items).filter((o) => o.id !== item.id && o.word.length > 1), rng).slice(0, 2);
        const choice = (o) => ({ id: o.id, value: o.id, label: o.word, word: o.word, emoji: null, say: o.word });
        return { ...base, type: 'choose', mode: 'sight', target: { label: null, emoji: null, say: item.word },
          word: item.word, title: 'Tap the word you hear!', prompt: `Find the word: ${item.word}.`, say: `Find the word: ${item.word}.`,
          choices: shuffle([item, ...others], rng).map(choice), answer: item.id };
      }
      return { ...base, type: 'build', mode: 'sight', word: item.word.toLowerCase(), picture: null, emoji: null,
        tiles: wordTiles(item.word, rng), showWord: types.includes('choose') ? false : showWord, say: `Spell the word ${item.word}.` };
    }
    case 'phrase':
      return { ...base, type: 'build-phrase', mode: 'phrase', phrase: item.phrase, word: item.phrase, words: item.words, emoji: item.emoji ?? null,
        tiles: wordTiles(item.phrase, rng, 3), showWord, say: `Let's spell: ${item.phrase}.` };
    default:
      return null;
  }
}

/**
 * Rounds for one session from the ladder: mostly the current level (missed and due items,
 * then new ones in order), plus spaced review of earlier levels that are due, so a child who
 * has mastered everything still gets a fresh mix every day.
 */
export function buildLadderRounds({ ladder, rounds = 5, progress = new Map(), rng = Math.random, now = Date.now(), types = LEGACY_TYPES }) {
  const status = ladderStatus(ladder, progress, { types });
  const open = ladder.levels.filter((l) => playable(l, types));
  if (!open.length) return [];
  const curIdx = Math.max(0, open.findIndex((l) => l.id === status.current));
  const cur = open[curIdx];
  // Everything mastered: every round is spaced review across all levels (due and least recently seen first).
  const earlier = status.allMastered ? open : open.slice(0, curIdx);
  const next = open[curIdx + 1] ?? null;
  const pools = { sight: ladder.levels.filter((l) => l.kind === 'sight').flatMap((l) => l.items) };
  const used = new Set();
  const out = [];
  const take = (level, item) => {
    if (!item || used.has(item.key)) return false;
    const r = roundForItem(level, item, { progress, rng, types, pools });
    if (!r) return false;
    used.add(item.key);
    out.push(r);
    return true;
  };
  const rec = (it) => progress.get(it.key);
  const missed = (it) => { const p = rec(it); return p && p.seen > 0 && !itemKnown(p); };

  // 1) spaced review of earlier levels (about 1 in 4 rounds)
  const reviewN = status.allMastered ? rounds : earlier.length ? Math.max(1, Math.round(rounds * 0.25)) : 0;
  const reviewPool = shuffle(earlier.flatMap((l) => l.items.map((it) => ({ l, it }))), rng)
    .sort((a, b) => (missed(b.it) - missed(a.it)) || (isDue(rec(b.it), now) - isDue(rec(a.it), now))
      || ((rec(a.it)?.lastSeen ?? 0) - (rec(b.it)?.lastSeen ?? 0)));
  const review = [];
  for (const { l, it } of reviewPool) { if (review.length >= reviewN) break; if (!used.has(it.key)) { used.add(it.key); review.push({ l, it }); } }
  review.forEach(({ it }) => used.delete(it.key));

  // 2) current level: missed first, then new items in ladder order, then the least recently seen
  const curItems = cur.items;
  const mainN = rounds - review.length;
  // new items: keep the ladder's easy-to-hard order, but shuffle within a small window so
  // sessions are not identical (A, a, B, b, C ... would be dull)
  const fresh = curItems.filter((it) => !rec(it) || rec(it).seen === 0);
  const win = Math.max(mainN * 2, 10);
  const order = [
    ...curItems.filter((it) => missed(it) && isDue(rec(it), now)),
    ...shuffle(fresh.slice(0, win), rng), ...fresh.slice(win),
    ...[...curItems].filter((it) => rec(it)?.seen > 0).sort((a, b) => (rec(a).lastSeen ?? 0) - (rec(b).lastSeen ?? 0)),
  ];
  const main = [];
  const seenKey = new Set();
  for (const it of order) {
    if (main.length >= mainN) break;
    if (seenKey.has(it.key)) continue;
    seenKey.add(it.key);
    main.push(it);
  }
  // 3) when the current level is almost done, one sneak peek of the next level
  if (next && main.length >= 3 && status.levels[cur.index].known >= Math.ceil(0.6 * curItems.length)) {
    const peek = next.items.find((it) => !rec(it));
    if (peek) main[main.length - 1] = { peek: true, l: next, it: peek };
  }

  // interleave: a review round after every 3 current-level rounds
  let ri = 0;
  main.forEach((m, i) => {
    if (m.peek) take(m.l, m.it); else take(cur, m);
    if ((i + 1) % 3 === 0 && ri < review.length) { const { l, it } = review[ri++]; take(l, it); }
  });
  while (ri < review.length) { const { l, it } = review[ri++]; take(l, it); }

  // 4) never run out: top up from any playable level, least recently seen first
  if (out.length < rounds) {
    const rest = open.flatMap((l) => l.items.map((it) => ({ l, it }))).filter(({ it }) => !used.has(it.key))
      .sort((a, b) => (rec(a.it)?.lastSeen ?? 0) - (rec(b.it)?.lastSeen ?? 0));
    for (const { l, it } of rest) { if (out.length >= rounds) break; take(l, it); }
  }
  return out.slice(0, rounds);
}

export class PhonicsSession {
  constructor({ id, profileId, rounds, progress, rewardSettings = null, ledger = [], clock = () => Date.now(),
    ladder = null, types = LEGACY_TYPES }) {
    Object.assign(this, { id, profileId, rounds, progress, rewardSettings, clock, ladder, types });
    this.ladderBefore = ladder ? ladderStatus(ladder, progress, { types }) : null;
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
    const isBuild = r.type === 'build' || r.type === 'build-phrase';
    const letters = (v) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const target = r.type === 'choose' ? String(r.answer) : isBuild ? letters(r.word ?? r.phrase) : String(r.letter).toLowerCase();
    const given = r.type === 'choose' ? String(input ?? '') : isBuild ? letters(input) : String(input ?? '').toLowerCase();
    if (isBuild && given.length < target.length) {
      return { correct: target.startsWith(given), partial: true, tries: this.tries, reveal: false };
    }
    const correct = given === target;
    const counted = this.tries === 0;
    this.tries++;
    if (counted) {
      const s = review(this.progress.get(r.key), { correct, attempt: given, sessionId: this.id, now: this.clock() });
      s.progress.key = r.key;
      this.progress.set(r.key, s.progress);
      this.answers.push({ key: r.key, correct, level: r.levelId ?? null });
    }
    const rw = answerReward({ correct, counted });
    this.totals.xp += rw.xp;
    this.totals.coins += rw.coins;
    return { correct, partial: false, tries: this.tries, reveal: !correct && this.tries >= 2,
      answer: r.type === 'choose' ? r.answer : isBuild ? (r.word ?? r.phrase) : r.letter,
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
    let ladder = null;
    if (this.ladder) {
      const after = ladderStatus(this.ladder, this.progress, { types: this.types });
      const before = this.ladderBefore;
      const newlyMasteredLevels = after.levels.filter((l, i) => l.mastered && !before?.levels[i]?.mastered).map((l) => l.id);
      ladder = { current: after.current, before: before?.current ?? null, newlyMasteredLevels,
        levelUp: !!before && after.currentIndex > before.currentIndex, levels: after.levels };
    }
    return {
      summary: { kind: 'phonics', answered, correct, accuracy: answered ? correct / answered : 0,
        ...this.totals, newlyMastered: [], fixitLeft: 0, ladder },
      ledgerEntries: tok.entry ? [tok.entry] : [],
    };
  }
}
