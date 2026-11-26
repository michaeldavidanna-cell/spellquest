// A2: re-rendered voices at the same paths must not play the old cached clips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioManifest, staleClipUrls } from '../app/js/audio/clips.js';

const raw = (extra) => ({ schema: 'spellingbee.audio/1', clips: { w0001: ['word', 'sentence'] }, ...extra });

test('clip URLs carry ?v=<version>, falling back to voice', () => {
  const m = parseAudioManifest(raw({ version: 'am_michael-2026-11-25', voice: 'am_michael' }), 'district-2026-r2');
  const u = new URL(m.clips.get('w0001').get('word'));
  assert.equal(u.searchParams.get('v'), 'am_michael-2026-11-25');
  assert.match(u.pathname, /audio\/district-2026-r2\/w0001\/word\.m4a$/);
  const old = parseAudioManifest(raw({ voice: 'af_heart' }), 'district-2026-r2');
  assert.equal(new URL(old.clips.get('w0001').get('word')).searchParams.get('v'), 'af_heart');
  const none = parseAudioManifest(raw({}), 'district-2026-r2');
  assert.equal(new URL(none.clips.get('w0001').get('word')).search, '');
  assert.equal(none.version, null);
});

test('a new version evicts that list\'s older and unversioned clips only', () => {
  const m = parseAudioManifest(raw({ version: 'v2' }), 'district-2026-r2');
  const word = m.clips.get('w0001').get('word');
  const at = (p) => new URL(p, m.base).href;
  const cached = [
    word,                                           // current: keep
    at('w0001/word.m4a?v=v1'),                      // older voice: evict
    at('w0001/sentence.m4a'),                       // unversioned (0.2.0/0.2.1 iPads): evict
    at('manifest.json'),                            // not a clip: keep
    new URL('../grade3/g0001/word.m4a?v=v1', m.base).href, // other list: keep
    new URL('../phonics/a.m4a', m.base).href,       // phonics recordings: keep
  ];
  assert.deepEqual(staleClipUrls(cached, m), [cached[1], cached[2]]);
});

test('no version (old manifest) evicts nothing', () => {
  const m = parseAudioManifest(raw({}), 'district-2026-r2');
  assert.deepEqual(staleClipUrls([new URL('w0001/word.m4a', m.base).href], m), []);
});

test('the same version again evicts nothing', () => {
  const m = parseAudioManifest(raw({ version: 'v2' }), 'district-2026-r2');
  assert.deepEqual(staleClipUrls([...m.clips.get('w0001').values()], m), []);
});
