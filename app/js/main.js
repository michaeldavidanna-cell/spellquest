// Boot: storage, service worker, word lists, theme, then hand off to the screens (bee-ui).
import { router } from './router.js';
import { events } from './store/events.js';
import { openDB, requestPersistence } from './store/db.js';
import { getActiveProfileId, getProfile, THEMES } from './store/profiles.js';
import { loadWordLists } from './store/wordlists.js';
import { speech } from './audio/speech.js';

export const VERSION = '0.1.2'; // keep in step with VERSION in sw.js

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function setTheme(themeId) {
  const id = THEMES.includes(themeId) ? themeId : THEMES[0];
  document.documentElement.dataset.theme = id;
}

function applyProfile(profile) {
  setTheme(profile?.theme);
  if (profile?.settings?.rate) speech.setWordRate(profile.settings.rate);
}

// ---- service worker ---------------------------------------------------------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    const notify = () => events.emit('sw:updated', {});
    if (reg.waiting && navigator.serviceWorker.controller) notify();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) notify();
      });
    });
    // Apply an update only while the app is in the background, never mid-word.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && reg.waiting) reg.waiting.postMessage({ type: 'skip-waiting' });
      else if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || document.visibilityState !== 'hidden') return;
      reloading = true;
      location.reload();
    });
    // The first visit is not controlled yet: ask the worker to cache what this page loaded.
    const ready = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map((e) => e.name)
      .filter((u) => u.startsWith(location.origin));
    ready.active?.postMessage({ type: 'cache-urls', urls: [location.href.split('#')[0], ...urls] });
  } catch (err) {
    console.warn('[main] service worker registration failed', err);
  }
}

function showFallback(root, message) {
  const p = document.createElement('p');
  p.style.cssText = 'font: 20px/1.4 -apple-system, sans-serif; padding: 24px; max-width: 40em';
  p.textContent = message;
  root.replaceChildren(p);
}

async function boot() {
  const root = document.getElementById('app');
  // Prime the voice list on every tap (cheap). Speaking itself happens inside screen handlers.
  document.addEventListener('pointerdown', () => speech.unlock(), { capture: true, passive: true });
  events.on('profile:active', ({ profile }) => applyProfile(profile));

  await openDB();
  requestPersistence(); // granted by heuristic; Home Screen apps are the usual case
  await loadWordLists();
  speech.initPhonicsRecordings();

  const activeId = getActiveProfileId();
  applyProfile(activeId ? await getProfile(activeId) : null);

  let registerScreens;
  try {
    ({ registerScreens } = await import('./screens/index.js'));
  } catch (err) {
    console.error('[main] screens failed to load', err);
    showFallback(root, 'The app could not start its screens. Reload with an internet connection once.');
    return;
  }
  registerScreens({ router, app });
  router.start('#/kids', root);
  registerServiceWorker();
}

export const app = {
  version: VERSION,
  events,
  setTheme,
  isStandalone,
  ready: null,
};

app.ready = boot().catch((err) => {
  console.error('[main] boot failed', err);
  const root = document.getElementById('app');
  if (root) {
    showFallback(root, err?.name === 'QuotaExceededError'
      ? 'This iPad is out of storage space. Free some space, then open the app again.'
      : 'Something went wrong while starting. Close the app and open it again.');
  }
  throw err;
});
