// Persistent side of the reward economy: XP/coins on the profile, tokens in the ledger.
import { db, getSetting, setSetting, newId } from '../store/db.js';
import { events } from '../store/events.js';
import { getProfile } from '../store/profiles.js';
import { requireParent } from '../parent/pin.js';
import {
  withDefaults, levelForXp, tokenBalance, earnedToday, checkCashIn, pendingCards,
} from './economy.js';

// Serialize writes so quick taps never lose an update.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export async function getRewardSettings() {
  return withDefaults(await getSetting('rewards'));
}

export async function setRewardSettings(patch, pin) {
  await requireParent(pin);
  const next = withDefaults({ ...(await getSetting('rewards')), ...patch });
  await setSetting('rewards', next);
  return next;
}

export async function getLedger(profileId = null) {
  return profileId ? db.getAllBy('ledger', 'byProfile', profileId) : db.getAll('ledger');
}

export async function getWallet(profileId) {
  const [profile, ledger, settings] = await Promise.all([getProfile(profileId), getLedger(profileId), getRewardSettings()]);
  if (!profile) throw new Error('Profile not found');
  const tokens = tokenBalance(ledger, profileId);
  const lv = levelForXp(profile.xp);
  return {
    xp: profile.xp, level: lv.level, levelProgress: lv.progress, nextLevelAt: lv.nextAt,
    coins: profile.coins, tokens, minutes: tokens * settings.minutesPerToken,
    rewardName: settings.rewardName, minutesPerToken: settings.minutesPerToken,
    pending: pendingCards(ledger, profileId),
    earnedToday: earnedToday(ledger, profileId), dailyCap: settings.dailyEarnCap,
    owned: profile.owned, equipped: profile.equipped,
  };
}

async function emitWallet(profileId) {
  try { events.emit('wallet:changed', { profileId, wallet: await getWallet(profileId) }); } catch { /* deleted */ }
}

/** Used by the session runner: add XP/coins and write earn entries. */
export function applyEarnings(profileId, { xp = 0, coins = 0, ledgerEntries = [], profilePatch = null }) {
  return serial(async () => {
    // Callback style (no await) keeps the transaction alive on every WebKit version.
    await db.tx(['profiles', 'ledger'], 'readwrite', ([profiles, ledger]) => {
      const r = profiles.get(profileId);
      r.onsuccess = () => {
        const p = r.result;
        if (!p) return;
        profiles.put({ ...p, ...(profilePatch ?? {}), xp: p.xp + xp, coins: p.coins + coins, updatedAt: Date.now() });
        for (const e of ledgerEntries) ledger.put(e);
      };
    });
    await emitWallet(profileId);
  });
}

export function requestCashIn(profileId, tokens) {
  return serial(async () => {
    const [ledger, settings] = await Promise.all([getLedger(profileId), getRewardSettings()]);
    const check = checkCashIn(tokens, ledger, profileId, settings);
    if (!check.ok) { const e = new Error(check.reason); e.code = check.reason; throw e; }
    const card = { id: newId('redeem'), profileId, at: Date.now(), type: 'redeem', tokens,
      minutes: check.minutes, reward: settings.rewardName, status: 'pending', requestedAt: Date.now(), resolvedAt: null };
    await db.put('ledger', card);
    await emitWallet(profileId);
    return card;
  });
}

async function resolveCard(cardId, status) {
  const card = await db.get('ledger', cardId);
  if (!card || card.type !== 'redeem') return { ok: false, reason: 'not-found' };
  if (card.status !== 'pending') return { ok: false, reason: 'already-resolved' };
  await db.put('ledger', { ...card, status, resolvedAt: Date.now() });
  await emitWallet(card.profileId);
  return { ok: true, card: { ...card, status } };
}

/** The kid can take back their own request before a parent acts on it. */
export function cancelRequest(cardId) {
  return serial(() => resolveCard(cardId, 'declined'));
}

export async function listPending() {
  return pendingCards(await getLedger());
}

/** Parent: "I added it" in the PlayStation Family app. */
export async function markAdded(cardId, pin) {
  try { await requireParent(pin); } catch (e) { return { ok: false, reason: e.code ?? e.message, lockedUntil: e.lockedUntil }; }
  return serial(() => resolveCard(cardId, 'added'));
}

export async function declineCard(cardId, pin) {
  try { await requireParent(pin); } catch (e) { return { ok: false, reason: e.code ?? e.message, lockedUntil: e.lockedUntil }; }
  return serial(() => resolveCard(cardId, 'declined'));
}

export async function adjustTokens(profileId, tokens, note, pin) {
  try { await requireParent(pin); } catch (e) { return { ok: false, reason: e.code ?? e.message }; }
  if (!Number.isInteger(tokens) || tokens === 0) return { ok: false, reason: 'invalid-amount' };
  return serial(async () => {
    await db.put('ledger', { id: newId('adj'), profileId, at: Date.now(), type: 'adjust', tokens, reason: String(note ?? '') });
    await emitWallet(profileId);
    return { ok: true };
  });
}

/** Coins buy cosmetics only. item = { id, cost, slot? } */
export function buyItem(profileId, item) {
  return serial(async () => {
    const p = await getProfile(profileId);
    if (!p) return { ok: false, reason: 'not-found' };
    if (p.owned.includes(item.id)) return { ok: false, reason: 'already-owned' };
    if (!(item.cost >= 0) || p.coins < item.cost) return { ok: false, reason: 'not-enough-coins' };
    await db.put('profiles', { ...p, coins: p.coins - item.cost, owned: [...p.owned, item.id], updatedAt: Date.now() });
    await emitWallet(profileId);
    return { ok: true };
  });
}

export function equipItem(profileId, slot, itemId) {
  return serial(async () => {
    const p = await getProfile(profileId);
    if (!p) return { ok: false, reason: 'not-found' };
    if (itemId && !p.owned.includes(itemId)) return { ok: false, reason: 'not-owned' };
    await db.put('profiles', { ...p, equipped: { ...p.equipped, [slot]: itemId }, updatedAt: Date.now() });
    await emitWallet(profileId);
    return { ok: true };
  });
}

export { ps5Steps } from './economy.js';
