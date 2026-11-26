// Offline service worker (T2 §2): cache-first for app files, network-first for the page.
// Bump VERSION (and VERSION in js/main.js) on every release.
const VERSION = '0.2.2';
const CACHE = `spellingbee-${VERSION}`;
// A1: recorded clips live in their own unversioned cache, filled on first play or by the
// parent's "Download all audio for offline" (js/audio/clips.js). They are never precached.
const AUDIO_CACHE = 'spellingbee-audio';
const MEDIA = /\/audio\/.+\.(m4a|mp3|aac|wav|ogg|opus)$/i;
// A2: audio manifests are network-first so a re-rendered voice is seen at once; clip URLs carry
// ?v=<manifest version> and are cached by their full URL (query included).
const AUDIO_MANIFEST = /\/audio\/[^/]+\/manifest\.json$/i;

// Core files. Missing entries are skipped so screens can be added without breaking install;
// the page also sends every file it loaded (see 'cache-urls').
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'js/main.js',
  'js/router.js',
  'js/store/events.js',
  'js/store/db.js',
  'js/store/profiles.js',
  'js/store/wordlists.js',
  'js/store/backup.js',
  'js/engine/time.js',
  'js/engine/srs.js',
  'js/engine/grade.js',
  'js/engine/text.js',
  'js/engine/wordlist.js',
  'js/engine/session.js',
  'js/engine/phonics.js',
  'js/engine/runner.js',
  'js/rewards/economy.js',
  'js/rewards/wallet.js',
  'js/parent/pin.js',
  'js/audio/speech.js',
  'js/audio/clips.js',
  'js/engine/clues.js',
  'js/store/phonics.js',
  'data/phonics.json',
  'js/screens/index.js',
  'js/screens/profiles.js',
  'js/screens/home.js',
  'js/screens/practice.js',
  'js/screens/competition.js',
  'js/screens/mistakes.js',
  'js/screens/phonics.js',
  'js/screens/rewards.js',
  'js/screens/parent.js',
  'js/ui/components.js',
  'js/ui/keyboard.js',
  'js/ui/themes.js',
  'js/ui/celebrations.js',
  'css/base.css',
  'css/themes/pinehook.css',
  'css/themes/ridgecrest.css',
  'css/themes/starquill.css',
  'css/themes/skydrop.css',
  'data/wordlists/index.json',
  'data/wordlists/round2.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

async function cacheAll(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') await cache.put(u, res);
    } catch { /* offline or missing: skip */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAll(CORE.map(scopeUrl)));
  // The first install takes over straight away; updates wait (main.js applies them in the background).
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('spellingbee-') && k !== CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'skip-waiting') self.skipWaiting();
  if (msg.type === 'cache-urls' && Array.isArray(msg.urls)) {
    const same = msg.urls.filter((u) => { try { return new URL(u).origin === self.location.origin; } catch { return false; } });
    event.waitUntil(cacheAll(same));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
    ]);
    if (res.ok) cache.put(scopeUrl('index.html'), res.clone());
    return res;
  } catch {
    return (await cache.match(scopeUrl('index.html'))) || (await cache.match(scopeUrl('./')))
      || new Response('<h1>Offline</h1><p>Open the app once with internet so it can save itself.</p>',
        { headers: { 'Content-Type': 'text/html' } });
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  const refresh = fetch(event.request).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(refresh); return cached; }
  return (await refresh) || new Response('', { status: 504, statusText: 'Offline' });
}

// Safari asks for media with a Range header and needs a 206 answer, so clips are cached
// whole and the requested byte range is cut from the cached copy.
async function rangeFrom(response, rangeHeader) {
  const buf = await response.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  const size = buf.byteLength;
  let start = m && m[1] !== '' ? Number(m[1]) : 0;
  let end = m && m[2] !== '' ? Number(m[2]) : size - 1;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } // suffix range
  if (start >= size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function audioClip(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const url = request.url.split('#')[0];
  let res = await cache.match(url); // exact URL: ?v=<version> must match, so an old voice never answers
  if (!res) {
    try {
      const net = await fetch(url, { cache: 'no-cache' }); // whole file, no Range, so it can be cached
      if (!net.ok) return net;
      await cache.put(url, net.clone()).catch(() => {}); // storage full: still play it
      res = net;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  }
  const range = request.headers.get('range');
  return range ? rangeFrom(res, range) : res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (res.ok) await cache.put(request.url.split('?')[0], res.clone());
    return res;
  } catch {
    return (await cache.match(request.url.split('?')[0])) || new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the app makes no third-party requests
  if (request.mode === 'navigate') { event.respondWith(networkFirstPage(request)); return; }
  if (AUDIO_MANIFEST.test(url.pathname)) { event.respondWith(networkFirst(request)); return; }
  if (MEDIA.test(url.pathname)) { event.respondWith(audioClip(request)); return; }
  event.respondWith(staleWhileRevalidate(event));
});
