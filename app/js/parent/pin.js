// Parent PIN: salted PBKDF2-SHA256 hash in IndexedDB, lockout after repeated misses.
// It keeps curious hands out of the parent area. It is not strong security on a shared device.
import { getSetting, setSetting } from '../store/db.js';
import { events } from '../store/events.js';

const ITERATIONS = 150_000;
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60_000;
/** A parent session opens when the PIN is typed on the pad and closes after this idle time. */
export const PARENT_SESSION_MS = 2 * 60_000;

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}

/** Pure (WebCrypto only): works in browsers and Node 20+. */
export async function hashPin(pin, saltHex, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hasPin() {
  return !!(await getSetting('pin'));
}

/**
 * Check a PIN typed on the PIN pad. Success opens (or extends) the parent session.
 * @param {string} pin
 * @param {number} [now]
 * @param {{silent?: boolean}} [opts] silent: check only, don't open a session (internal use)
 */
export async function verifyPin(pin, now = Date.now(), opts = {}) {
  const stored = await getSetting('pin');
  if (!stored) return { ok: false, reason: 'no-pin', triesLeft: MAX_TRIES, lockedUntil: 0 };
  const lock = (await getSetting('pinLock')) ?? { fails: 0, lockedUntil: 0 };
  if (lock.lockedUntil > now) return { ok: false, reason: 'locked', triesLeft: 0, lockedUntil: lock.lockedUntil };
  const ok = isValidPin(pin) && timingSafeEqual(await hashPin(pin, stored.salt, stored.iterations), stored.hash);
  if (ok) {
    if (lock.fails) await setSetting('pinLock', { fails: 0, lockedUntil: 0 });
    if (!opts.silent) openParentSession(now);
    return { ok: true, triesLeft: MAX_TRIES, lockedUntil: 0 };
  }
  const fails = (lock.lockedUntil && lock.lockedUntil <= now ? 0 : lock.fails) + 1;
  const lockedUntil = fails >= MAX_TRIES ? now + LOCK_MS : 0;
  await setSetting('pinLock', { fails: lockedUntil ? 0 : fails, lockedUntil });
  return { ok: false, reason: lockedUntil ? 'locked' : 'wrong-pin', triesLeft: lockedUntil ? 0 : MAX_TRIES - fails, lockedUntil };
}

export async function setPin(newPin, currentPin) {
  if (!isValidPin(newPin)) return { ok: false, reason: 'pin-must-be-4-to-6-digits' };
  if (await hasPin()) {
    const v = await verifyPin(currentPin, Date.now(), { silent: true });
    if (!v.ok) return { ok: false, reason: v.reason, lockedUntil: v.lockedUntil };
  }
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(newPin, salt);
  await setSetting('pin', { hash, salt, iterations: ITERATIONS, setAt: Date.now() });
  await setSetting('pinLock', { fails: 0, lockedUntil: 0 });
  return { ok: true };
}

/** Throws unless the PIN checks out. Used by core functions that need a parent. */
export async function requirePin(pin) {
  const v = await verifyPin(pin, Date.now(), { silent: true });
  if (!v.ok) {
    const err = new Error(v.reason);
    err.code = v.reason;
    err.lockedUntil = v.lockedUntil;
    throw err;
  }
}

// ---- parent session (M6) ------------------------------------------------------
// A cached PIN alone is not enough for PS5 minutes and token changes: the parent must
// have typed the PIN within the last PARENT_SESSION_MS of activity, and leaving the app
// (visibilitychange -> hidden) locks immediately. This stops a child from approving their
// own minutes on a Parent screen that was left open.
let sessionUntil = 0;
let sessionTimer = null;

function openParentSession(now = Date.now()) {
  const wasOpen = sessionUntil > now;
  sessionUntil = now + PARENT_SESSION_MS;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => lockParent('idle'), PARENT_SESSION_MS);
  if (!wasOpen) events.emit('parent:unlocked', { until: sessionUntil });
}

export function parentSessionActive(now = Date.now()) {
  return sessionUntil > now;
}

/** Lock now (e.g. "Lock & Exit"). Emits parent:locked { reason }. */
export function lockParent(reason = 'manual') {
  const wasOpen = sessionUntil > Date.now();
  sessionUntil = 0;
  clearTimeout(sessionTimer);
  sessionTimer = null;
  if (wasOpen) events.emit('parent:locked', { reason });
}

/**
 * For actions that touch real-world rewards: needs an open parent session AND the PIN.
 * Success extends the session. Throws with code 'parent-locked' | 'wrong-pin' | 'locked' | 'no-pin'.
 */
export async function requireParent(pin) {
  if (!parentSessionActive()) {
    const err = new Error('parent-locked');
    err.code = 'parent-locked';
    throw err;
  }
  await requirePin(pin);
  openParentSession();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lockParent('hidden');
  });
}
