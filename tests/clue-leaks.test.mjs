// A1: no clue the app can show may reveal the spelling of its word.
// Runs the shared sanitizer (app/js/engine/clues.js) over every word in every list in
// app/data/wordlists and checks the output with an independent, stricter detector.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWordList, WORDLIST_SCHEMA } from '../app/js/engine/wordlist.js';
import { clueText, SAFE_CLUE_KINDS, sanitizeClue } from '../app/js/engine/clues.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/data/wordlists');

function loadLists() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!Array.isArray(raw) && raw.schema && raw.schema !== WORDLIST_SCHEMA) return null;
    return { file: f, list: normalizeWordList(raw, { id: f.replace(/\.json$/, '') }) };
  }).filter(Boolean);
}

// Independent detector: deliberately simpler and stricter than the sanitizer.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function leak(text, word) {
  const w = fold(word).replace(/[^a-z]/g, '');
  if (w.length < 2) return null;
  // tokens, keeping track of whether only space/hyphen/dot separates them from the next one
  const parts = fold(text).split(/([a-z]+)/);
  const toks = [];
  for (let i = 1; i < parts.length; i += 2) toks.push({ t: parts[i], sepBefore: parts[i - 1] });
  for (let i = 0; i < toks.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(toks.length, i + 6); j++) {
      if (j > i && !/^[\s\-‐–·.'’]*$/.test(toks[j].sepBefore)) break;
      joined += toks[j].t;
      const single = j === i;
      if (joined === w) return joined;
      if (single && w.length >= 3 && joined.startsWith(w) && joined.length - w.length <= 4) return joined;  // plurals, -ed, -ing
      if (single && w.length >= 5 && joined.includes(w)) return joined;                                     // word inside a word
      if (single && joined.length >= 4 && w.length >= 5 && w.startsWith(joined) && w.length - joined.length <= 3) return joined; // steps->step
    }
  }
  return null;
}

const lists = loadLists();

test('there is at least one word list to check', () => {
  assert.ok(lists.length >= 1);
  assert.ok(lists.every(({ list }) => list.words.length > 0));
});

for (const { file, list } of lists) {
  test(`no clue leaks the spelling: ${file} (${list.words.length} words)`, () => {
    const leaks = [];
    for (const w of list.words) {
      for (const kind of SAFE_CLUE_KINDS) {
        const shown = clueText(w, kind);
        if (!shown) continue;
        for (const form of w.accept) {
          const hit = leak(shown, form);
          if (hit) leaks.push(`${w.id} "${w.word}" ${kind}: "${shown}" (shows "${hit}")`);
        }
      }
    }
    assert.deepEqual(leaks, [], `${leaks.length} leaks:\n${leaks.slice(0, 40).join('\n')}`);
  });
}

test('sanitizer catches the leaks seen on the iPad and known variants', () => {
  const krio = { word: 'Krio', accept: ['Krio'], origin: 'Krio', audio: {} };
  assert.ok(!/krio/i.test(clueText(krio, 'origin')));
  assert.ok(clueText(krio, 'origin').length > 0, 'a same-name origin still gets a safe hint');
  assert.equal(clueText({ word: 'ran', accept: ['ran'], audio: { respell: 'RAN' } }, 'respell'), '');
  assert.equal(clueText({ word: 'winter', accept: ['winter'], audio: { respell: 'WIN-ter' } }, 'respell'), '');
  const cases = [
    ['steps', 'Take one step at a time.'],
    ['invite', 'She invited the whole team.'],
    ['happy', 'They smiled happily.'],
    ['stop', 'The bus stopped.'],
    ['piñata', 'We hit the pinata.'],
    ['Addis Ababa', 'They flew to Addis Ababa.'],
    ['Addis Ababa', 'They flew to addis-ababa.'],
    ['finish', 'The unfinished trail.'],
    ['shivering', 'He began to shiver.'],
  ];
  for (const [word, text] of cases) {
    const out = sanitizeClue(text, word);
    assert.equal(leak(out, word), null, `${word}: "${out}"`);
    assert.match(out, /______/, `${word}: masked in "${out}"`);
  }
  assert.equal(sanitizeClue('A cold wind pushed the boat.', 'ran'), 'A cold wind pushed the boat.', 'unrelated text is untouched');
});
