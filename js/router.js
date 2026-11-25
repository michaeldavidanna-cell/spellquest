// Hash router: '#/home/:profileId' style patterns. Screen = { mount(root, params, query) -> cleanup? }
import { events } from './store/events.js';

const routes = [];
let cleanup = null;
let defaultHash = '#/kids';
let currentMatch = { hash: '', params: {}, query: {} };
let root = null;

function compile(pattern) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`))
    .replace(/\\?:([A-Za-z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { re, keys };
}

function parse(hash) {
  const [path, qs = ''] = (hash || '').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { route: r, params, query, hash: path };
    }
  }
  return null;
}

async function render() {
  const match = parse(location.hash);
  if (!match) { go(defaultHash, { replace: true }); return; }
  try { cleanup?.(); } catch (err) { console.error('[router] cleanup failed', err); }
  cleanup = null;
  root.replaceChildren();
  root.scrollTop = 0;
  currentMatch = { hash: match.hash, params: match.params, query: match.query };
  try {
    const out = await match.route.screen.mount(root, match.params, match.query);
    cleanup = typeof out === 'function' ? out : null;
  } catch (err) {
    console.error('[router] mount failed', err);
  }
  events.emit('route', currentMatch);
}

export function on(pattern, screen) {
  routes.push({ pattern, screen, ...compile(pattern) });
}

export function go(hash, { replace = false } = {}) {
  if (!hash.startsWith('#')) hash = `#${hash}`;
  if (replace) { history.replaceState(null, '', hash); render(); }
  else if (location.hash === hash) render();
  else location.hash = hash;
}

export function back() {
  if (history.length > 1) history.back();
  else go(defaultHash, { replace: true });
}

export function current() {
  return currentMatch;
}

export function start(dflt = '#/kids', rootEl = document.getElementById('app')) {
  defaultHash = dflt;
  root = rootEl;
  window.addEventListener('hashchange', render);
  render();
}

export const router = { on, go, back, current, start };
export default router;
