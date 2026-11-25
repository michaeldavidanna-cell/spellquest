// R4: a kid with no lists picked studies the lists that fit their mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultListIds } from '../app/js/engine/wordlist.js';

const lists = [{ id: 'district-2026-r2', grade: null }, { id: 'grade3', grade: 3 }, { id: 'import-x', grade: null }];

test('practice gets the grade<=4 lists, competition the bee lists, phonics everything', () => {
  assert.deepEqual(defaultListIds(lists, 'practice'), ['grade3']);
  assert.deepEqual(defaultListIds(lists, 'competition'), ['district-2026-r2', 'import-x']);
  assert.deepEqual(defaultListIds(lists, 'phonics'), lists.map((l) => l.id));
});

test('falls back to every list when nothing fits', () => {
  const only = [{ id: 'district-2026-r2', grade: null }];
  assert.deepEqual(defaultListIds(only, 'practice'), ['district-2026-r2']);
});
