// Minimal IndexedDB wrapper. One database, versioned migrations.
import { events } from './events.js';

export const DB_NAME = 'spellingbee';
export const DB_VERSION = 1;
export const STORES = ['profiles', 'progress', 'sessions', 'ledger', 'wordlists', 'settings'];

const MIGRATIONS = {
  1(db) {
    db.createObjectStore('profiles', { keyPath: 'id' });
    const progress = db.createObjectStore('progress', { keyPath: ['profileId', 'key'] });
    progress.createIndex('byProfile', 'profileId');
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('byProfile', 'profileId');
    const ledger = db.createObjectStore('ledger', { keyPath: 'id' });
    ledger.createIndex('byProfile', 'profileId');
    db.createObjectStore('wordlists', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });
  },
};

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      for (let v = e.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v]?.(db, r.transaction);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    r.onerror = () => { dbPromise = null; reject(r.error); };
    r.onblocked = () => console.warn('[db] upgrade blocked by another open tab');
  });
  return dbPromise;
}

async function withStore(names, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let out;
    tx.oncomplete = () => resolve(out);
    tx.onabort = tx.onerror = () => {
      const err = tx.error;
      if (err?.name === 'QuotaExceededError') events.emit('storage:error', { error: err });
      reject(err);
    };
    const stores = Array.isArray(names) ? names.map((n) => tx.objectStore(n)) : tx.objectStore(names);
    Promise.resolve(fn(stores, tx)).then((v) => { out = v; }, (err) => { try { tx.abort(); } catch {} reject(err); });
  });
}

export const db = {
  get: (store, key) => withStore(store, 'readonly', (s) => req(s.get(key))),
  getAll: (store) => withStore(store, 'readonly', (s) => req(s.getAll())),
  getAllBy: (store, index, value) => withStore(store, 'readonly', (s) => req(s.index(index).getAll(value))),
  put: (store, value) => withStore(store, 'readwrite', (s) => req(s.put(value))),
  putMany: (store, values) => withStore(store, 'readwrite', (s) => Promise.all(values.map((v) => req(s.put(v))))),
  delete: (store, key) => withStore(store, 'readwrite', (s) => req(s.delete(key))),
  clear: (store) => withStore(store, 'readwrite', (s) => req(s.clear())),
  /** Run fn(storesArray, tx) in one transaction over several stores. */
  tx: (stores, mode, fn) => withStore(stores, mode, fn),
  req,
};

// ---- key/value settings ---------------------------------------------------
export async function getSetting(key, fallback = null) {
  const row = await db.get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.put('settings', { key, value });
}

/** Ask the browser to keep our storage (granted heuristically, e.g. Home Screen app). */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

export function newId(prefix = '') {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}_${rnd}` : rnd;
}
