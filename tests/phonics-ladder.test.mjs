// A1: phonics level ladder (data/phonics.json + engine/phonics.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLadder, ladderStatus, buildLadderRounds, PhonicsSession, LEGACY_TYPES, PHONICS_TYPES } from '../app/js/engine/phonics.js';
import { parseAudioManifest } from '../app/js/audio/clips.js';

const raw = JSON.parse(fs.readFileSync(new URL('../app/data/phonics.json', import.meta.url), 'utf8'));
const ladder = parseLadder(raw);
const DAY = 86_400_000;

function seeded(seed = 1) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function rightAnswer(r) {
  if (r.type === 'choose') return r.answer;
  if (r.type === 'build') return r.word;
  if (r.type === 'build-phrase') return r.phrase;
  return r.letter;
}

function wrongAnswer(r) {
  if (r.type === 'choose') return r.choices.find((c) => c.id !== r.answer).id;
  if (r.type === 'build' || r.type === 'build-phrase') return 'q'.repeat(String(r.word ?? r.phrase).replace(/[^a-z]/gi, '').length);
  return r.choices.find((c) => c.toLowerCase() !== r.letter);
}

/** Play `sessions` daily sessions; `skill(r)` says whether the child answers right first time. */
function play({ types, sessions, size = 8, skill = () => true }) {
  const progress = new Map();
  const rng = seeded(7);
  const levelsSeen = [];
  let now = Date.UTC(2026, 10, 25, 16);
  const keys = new Set();
  for (let s = 0; s < sessions; s++) {
    const rounds = buildLadderRounds({ ladder, rounds: size, progress, rng, now, types });
    assert.equal(rounds.length, size, `session ${s} has ${size} rounds`);
    const sess = new PhonicsSession({ id: `p${s}`, profileId: 'kid', rounds, progress, ladder, types, clock: () => now });
    levelsSeen.push(sess.ladderBefore.current); // level at the start of the session
    for (const r of rounds) {
      assert.ok(types.includes(r.type), `${r.type} allowed`);
      keys.add(r.key);
      const res = sess.answer(skill(r) ? rightAnswer(r) : wrongAnswer(r));
      assert.equal(res.partial, false);
      sess.next();
    }
    const { summary } = sess.finish();
    assert.ok(summary.ladder && Array.isArray(summary.ladder.levels));
    now += DAY;
  }
  return { progress, levelsSeen, keys };
}

test('phonics.json is a valid ladder with several hundred unique items', () => {
  assert.ok(ladder, 'parses');
  const ids = ladder.levels.map((l) => l.id);
  for (const id of ['letter-names', 'letter-sounds', 'rhyming', 'cvc', 'digraphs', 'blends', 'sight-preprimer', 'sight-primer', 'phrases']) {
    assert.ok(ids.includes(id), id);
  }
  const keys = ladder.levels.flatMap((l) => l.items.map((i) => i.key));
  assert.equal(new Set(keys).size, keys.length, 'item keys are unique');
  assert.ok(keys.length >= 500, `${keys.length} items`);
  assert.equal(ladder.levels.find((l) => l.id === 'sight-preprimer').items.length, 40);
  assert.equal(ladder.levels.find((l) => l.id === 'sight-primer').items.length, 52);
});

test('a child who gets everything right climbs the whole ladder and never runs out', () => {
  const { levelsSeen, keys } = play({ types: PHONICS_TYPES, sessions: 120, size: 8 });
  assert.equal(levelsSeen[0], 'letter-names');
  assert.ok(new Set(levelsSeen).size >= 8, `reached ${[...new Set(levelsSeen)].join(', ')}`);
  assert.equal(levelsSeen.at(-1), 'phrases');
  assert.ok(keys.size >= 400, `${keys.size} different items played`);
});

test('a perfect child tests out of an easy level quickly', () => {
  const { levelsSeen } = play({ types: PHONICS_TYPES, sessions: 3, size: 8 });
  assert.notEqual(levelsSeen[1], 'letter-names', `after 2 perfect sessions: ${levelsSeen.join(', ')}`);
});

test('a child who misses stays on the level and gets missed items back', () => {
  let n = 0;
  const { progress, levelsSeen } = play({ types: PHONICS_TYPES, sessions: 6, size: 8, skill: () => (n++ % 2 === 0) });
  assert.ok(!levelsSeen.includes('cvc'), `a 50% child should not race ahead: ${levelsSeen.join(',')}`);
  assert.ok([...progress.values()].some((p) => p.wrong > 0 && p.seen > 1), 'a missed item came back');
});

test('B2 screens (legacy types only) still get playable rounds and skip new-type levels', () => {
  const { levelsSeen } = play({ types: LEGACY_TYPES, sessions: 40, size: 5 });
  assert.ok(!levelsSeen.includes('rhyming') && !levelsSeen.includes('phrases'));
  const st = ladderStatus(ladder, new Map(), { types: LEGACY_TYPES });
  assert.equal(st.levels.find((l) => l.id === 'rhyming').playable, false);
});

test('answers: choose by id, phrases ignore spaces and case, letters ignore case', () => {
  const st = new Map();
  const rounds = [
    { type: 'choose', key: 'k1', answer: 'hat', choices: [] },
    { type: 'build-phrase', key: 'k2', phrase: 'big dog' },
    { type: 'find-letter', key: 'k3', letter: 'b' },
  ];
  const s = new PhonicsSession({ id: 's', profileId: 'p', rounds, progress: st });
  assert.equal(s.answer('hat').correct, true); s.next();
  assert.equal(s.answer('big').partial, true);
  assert.equal(s.answer('BIG DOG').correct, true); s.next();
  assert.equal(s.answer('B').correct, true);
});

test('audio manifest: list of kinds or explicit files, same-origin only', () => {
  const m = parseAudioManifest({ schema: 'spellingbee.audio/1', clips: {
    w0001: ['word', 'sentence', 'bogus'],
    w0002: { word: 'w0002/word.m4a', definition: 'https://evil.example/x.m4a', origin: '../../x.m4a' },
  } }, 'district-2026-r2');
  assert.match(m.clips.get('w0001').get('word'), /audio\/district-2026-r2\/w0001\/word\.m4a$/);
  assert.ok(m.clips.get('w0001').has('sentence'));
  assert.ok(!m.clips.get('w0001').has('bogus'));
  assert.equal(m.clips.get('w0002').size, 1, 'remote and ../ paths are ignored');
  assert.equal(parseAudioManifest({ schema: 'other/1', clips: {} }, 'x'), null);
});
