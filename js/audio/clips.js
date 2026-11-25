// Pre-recorded natural-voice clips (A1, produced by bee-eng's V1 pipeline).
//   app/audio/<listId>/manifest.json
//   app/audio/<listId>/<wordId>/{word,definition,sentence,origin}.m4a
// Manifests are loaded at boot so the speak call inside a tap can pick a clip synchronously.
// Clips are NOT precached by the service worker: each one is cached the first time it plays,
// or all at once when a parent taps "Download all audio for offline" (downloadAllAudio).
// Same-origin files only; nothing leaves the device.

export const AUDIO_SCHEMA = 'spellingbee.audio/1';
export const CLIP_KINDS = ['word', 'definition', 'sentence', 'origin'];
/** Cache Storage name shared with sw.js. Not versioned, so clips survive app updates. */
export const AUDIO_CACHE = 'spellingbee-audio';

const BASE = new URL('../../audio/', import.meta.url);
const manifests = new Map(); // listId -> { ext, clips: Map(wordId -> Map(kind -> url)), bytes }

function safeSeg(s) {
  return encodeURIComponent(String(s ?? '').trim());
}

/** Parse a manifest object (pure; exported for tests). */
export function parseAudioManifest(raw, listId) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schema && raw.schema !== AUDIO_SCHEMA) return null;
  const ext = String(raw.ext || 'm4a').replace(/^\./, '');
  const base = new URL(`${safeSeg(listId)}/`, BASE);
  const clips = new Map();
  for (const [wordId, entry] of Object.entries(raw.clips ?? {})) {
    const kinds = new Map();
    // ["word","sentence"]  or  {"word":"w0001/word.m4a", ...}
    const pairs = Array.isArray(entry)
      ? entry.map((k) => [k, `${safeSeg(wordId)}/${safeSeg(k)}.${ext}`])
      : Object.entries(entry ?? {}).map(([k, file]) => [k, String(file)]);
    for (const [kind, rel] of pairs) {
      if (!CLIP_KINDS.includes(kind) || !rel || /^[a-z]+:|^\/|\.\./i.test(rel)) continue; // same-origin, inside the list folder
      kinds.set(kind, new URL(rel, base).href);
    }
    if (kinds.size) clips.set(String(wordId), kinds);
  }
  return { listId, ext, clips, bytes: Number(raw.bytes) || null, voice: raw.voice ?? null };
}

/** Load manifests for these lists. Missing manifests are fine (speech falls back to the device voice). */
export async function loadAudioManifests(listIds) {
  await Promise.all([...new Set(listIds)].filter(Boolean).map(async (id) => {
    if (String(id).startsWith('import-')) return; // imported lists have no recordings
    try {
      const res = await fetch(new URL(`${safeSeg(id)}/manifest.json`, BASE), { cache: 'no-cache' });
      if (!res.ok) return;
      const m = parseAudioManifest(await res.json(), id);
      if (m) manifests.set(id, m);
    } catch { /* offline with no cached manifest, or no audio yet */ }
  }));
  return [...manifests.keys()];
}

/** URL of a recorded clip for this word, or null. Synchronous (safe inside a tap). */
export function clipUrl(word, kind) {
  if (!word) return null;
  return manifests.get(word.listId)?.clips.get(String(word.id))?.get(kind) ?? null;
}

export function hasClip(word, kind) {
  return clipUrl(word, kind) !== null;
}

function allUrls(listIds) {
  const ids = listIds?.length ? listIds : [...manifests.keys()];
  const urls = [];
  for (const id of ids) for (const kinds of manifests.get(id)?.clips.values() ?? []) urls.push(...kinds.values());
  return urls;
}

async function openCache() {
  if (typeof caches === 'undefined') throw Object.assign(new Error('Offline storage is not available'), { code: 'no-cache-storage' });
  return caches.open(AUDIO_CACHE);
}

/** { total, cached, bytesCached } for the loaded manifests (or the given list ids). */
export async function audioStatus(listIds) {
  const urls = allUrls(listIds);
  if (!urls.length || typeof caches === 'undefined') return { total: urls.length, cached: 0, bytesCached: 0 };
  const cache = await openCache();
  const keys = new Set((await cache.keys()).map((r) => r.url));
  return { total: urls.length, cached: urls.filter((u) => keys.has(u)).length, bytesCached: null };
}

let downloading = null;

/**
 * Parent action "Download all audio for offline". Fetches every clip not yet cached into
 * Cache Storage (4 at a time). Safe to call again: it resumes where it stopped.
 * @param {{listIds?:string[], onProgress?:(p:{done:number,total:number,failed:number})=>void, signal?:AbortSignal}} opts
 * @returns {Promise<{ok:boolean, total:number, done:number, failed:number, aborted?:boolean, reason?:string}>}
 */
export function downloadAllAudio({ listIds, onProgress, signal } = {}) {
  if (downloading) return downloading;
  downloading = (async () => {
    const urls = allUrls(listIds);
    if (!urls.length) return { ok: false, total: 0, done: 0, failed: 0, reason: 'no-audio' };
    let cache;
    try { cache = await openCache(); } catch (err) { return { ok: false, total: urls.length, done: 0, failed: 0, reason: err.code || 'no-cache-storage' }; }
    const have = new Set((await cache.keys()).map((r) => r.url));
    const todo = urls.filter((u) => !have.has(u));
    let done = urls.length - todo.length;
    let failed = 0;
    const report = () => { try { onProgress?.({ done, total: urls.length, failed }); } catch { /* ignore */ } };
    report();
    let next = 0;
    let full = false; // storage full: stop every worker
    const worker = async () => {
      while (next < todo.length && !signal?.aborted && !full) {
        const url = todo[next++];
        try {
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(url, res);
          done++;
        } catch (err) {
          if (signal?.aborted) break;
          failed++;
          if (err?.name === 'QuotaExceededError') { full = true; break; }
        }
        report();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const aborted = !!signal?.aborted;
    return { ok: !aborted && !full && failed === 0 && done === urls.length, total: urls.length, done, failed, aborted,
      ...(full ? { reason: 'storage-full' } : {}) };
  })().finally(() => { downloading = null; });
  return downloading;
}

/** Parent action: remove every downloaded clip (they come back as they are played). */
export async function clearAudio() {
  if (typeof caches === 'undefined') return false;
  return caches.delete(AUDIO_CACHE);
}

export const clips = { loadAudioManifests, clipUrl, hasClip, audioStatus, downloadAllAudio, clearAudio };
export default clips;
