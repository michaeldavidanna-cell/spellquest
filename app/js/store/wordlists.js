// Word lists: built-in JSON files under app/data/wordlists/ plus lists a parent imports.
import { db } from './db.js';
import { events } from './events.js';
import { normalizeWordList, mergeWords, beeDateFor } from '../engine/wordlist.js';
import { localDay } from '../engine/time.js';

const BASE = new URL('../../data/wordlists/', import.meta.url);
let lists = [];

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function builtinFiles() {
  try {
    const idx = await fetchJson(new URL('index.json', BASE));
    if (Array.isArray(idx?.lists) && idx.lists.length) return idx.lists;
  } catch { /* fall through */ }
  return ['round2.json'];
}

/** Fetch built-ins (falling back to the last stored copy) and merge with imported lists. */
export async function loadWordLists() {
  const stored = await db.getAll('wordlists').catch(() => []);
  const byId = new Map(stored.map((l) => [l.id, l]));
  const fresh = [];
  for (const file of await builtinFiles()) {
    const id = String(file).replace(/\.json$/i, '');
    try {
      const list = normalizeWordList(await fetchJson(new URL(file, BASE)), { id, source: 'builtin' });
      list.file = file;
      fresh.push(list);
    } catch (err) {
      if (!byId.has(id)) console.warn(`[wordlists] could not load ${file}`, err);
    }
  }
  if (fresh.length) await db.putMany('wordlists', fresh).catch(() => {});
  for (const l of fresh) byId.set(l.id, l);
  lists = [...byId.values()].sort((a, b) => (a.source === b.source ? a.title.localeCompare(b.title) : a.source === 'builtin' ? -1 : 1));
  events.emit('wordlists:changed', { lists });
  return lists;
}

export function getWordLists() {
  return lists;
}

export function wordsForProfile(profile) {
  return mergeWords(lists, profile?.wordListIds ?? []);
}

export function beeDateForProfile(profile, now = Date.now()) {
  return profile?.settings?.beeDate || beeDateFor(lists, profile?.wordListIds ?? [], localDay(now));
}

export async function importWordListFile(file) {
  const text = await file.text();
  const base = (file.name || 'imported').replace(/\.json$/i, '');
  const list = normalizeWordList(JSON.parse(text), { id: `import-${base}`, source: 'import' });
  if (!list.id.startsWith('import-')) list.id = `import-${list.id}`;
  list.words = list.words.map((w) => ({ ...w, listId: list.id }));
  list.importedAt = Date.now();
  await db.put('wordlists', list);
  await loadWordLists();
  return list;
}

export async function removeImportedList(id) {
  const l = lists.find((x) => x.id === id);
  if (!l || l.source !== 'import') throw new Error('Only imported lists can be removed');
  await db.delete('wordlists', id);
  await loadWordLists();
}
