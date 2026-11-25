// Loads the phonics level ladder (data/phonics.json). The service worker caches the file,
// so it works offline after the first visit. Falls back to the built-in letters/CVC set.
import { parseLadder } from '../engine/phonics.js';

const URL_ = new URL('../../data/phonics.json', import.meta.url);
let cached = null;
let loading = null;

/** @returns {Promise<object|null>} parsed ladder, or null (the engine then uses its built-in set) */
export function loadPhonicsLadder() {
  if (cached) return Promise.resolve(cached);
  loading ??= (async () => {
    try {
      const res = await fetch(URL_, { cache: 'no-cache' });
      if (!res.ok) return null;
      cached = parseLadder(await res.json());
      return cached;
    } catch {
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}
