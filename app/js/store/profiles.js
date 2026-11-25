// Kid profiles (IndexedDB) and the active profile (localStorage).
import { db, newId } from './db.js';
import { events } from './events.js';

const ACTIVE_KEY = 'spellingbee.activeProfile';

export const MODE_DEFAULTS = {
  competition: { sessionSize: 12, timerSec: 60, beeRules: false, showLength: false, keyboard: 'qwerty',
    clues: ['definition', 'sentence', 'partOfSpeech', 'origin', 'altPronunciation'], rate: 0.85, beeDate: null },
  practice: { sessionSize: 8, timerSec: null, beeRules: false, showLength: true, keyboard: 'qwerty',
    clues: ['definition', 'sentence', 'syllables'], rate: 0.8, beeDate: null },
  phonics: { sessionSize: 5, timerSec: null, beeRules: false, showLength: true, keyboard: 'guided',
    clues: [], rate: 0.75, beeDate: null },
};

export const THEMES = ['pinehook', 'ridgecrest', 'starquill', 'skydrop'];

export async function listProfiles() {
  const all = await db.getAll('profiles');
  return all.sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
}

export async function getProfile(id) {
  return (await db.get('profiles', id)) ?? null;
}

let lastCreatedAt = 0;

export async function createProfile({ name, mode = 'practice', avatar = null, theme = 'pinehook', wordListIds = [] }) {
  if (!MODE_DEFAULTS[mode]) throw new Error(`Unknown mode: ${mode}`);
  // Strictly increasing so profiles created in the same millisecond keep their order.
  const now = Math.max(Date.now(), lastCreatedAt + 1);
  lastCreatedAt = now;
  const profile = {
    id: newId('kid'), name: String(name || 'Speller').trim(), avatar, theme, mode, wordListIds,
    xp: 0, coins: 0, owned: [], equipped: {}, streak: { count: 0, lastDay: null },
    settings: { ...MODE_DEFAULTS[mode] }, createdAt: now, updatedAt: now,
  };
  await db.put('profiles', profile);
  events.emit('profiles:changed', {});
  return profile;
}

export async function updateProfile(id, patch) {
  const cur = await getProfile(id);
  if (!cur) throw new Error('Profile not found');
  const next = { ...cur, ...patch, id, settings: { ...cur.settings, ...(patch.settings ?? {}) }, updatedAt: Date.now() };
  if (patch.mode && patch.mode !== cur.mode && !patch.settings) {
    next.settings = { ...MODE_DEFAULTS[patch.mode], beeDate: cur.settings.beeDate };
  }
  await db.put('profiles', next);
  events.emit('profiles:changed', {});
  if (getActiveProfileId() === id) events.emit('profile:active', { profile: next });
  return next;
}

export async function deleteProfile(id, pin) {
  const { requirePin } = await import('../parent/pin.js');
  await requirePin(pin);
  // Collect keys first, then delete in one write transaction (no awaits inside it).
  const keys = {};
  for (const store of ['progress', 'sessions', 'ledger']) {
    keys[store] = await db.tx(store, 'readonly', (s) => db.req(s.index('byProfile').getAllKeys(id)));
  }
  await db.tx(['profiles', 'progress', 'sessions', 'ledger'], 'readwrite', ([profiles, progress, sessions, ledger]) => {
    profiles.delete(id);
    for (const k of keys.progress) progress.delete(k);
    for (const k of keys.sessions) sessions.delete(k);
    for (const k of keys.ledger) ledger.delete(k);
  });
  if (getActiveProfileId() === id) setActiveProfile(null);
  events.emit('profiles:changed', {});
}

export function getActiveProfileId() {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export async function setActiveProfile(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* private mode: ignore */ }
  const profile = id ? await getProfile(id) : null;
  events.emit('profile:active', { profile });
  return profile;
}
