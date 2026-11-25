// Backup and restore of everything on the device (T1 §6). The PIN hash is never exported.
import { db, STORES, getSetting, setSetting } from './db.js';
import { events } from './events.js';
import { requirePin } from '../parent/pin.js';

export const BACKUP_SCHEMA = 'spellingbee.backup/1';
const SKIP_SETTINGS = new Set(['pin', 'pinLock']);

export async function exportBackup(now = Date.now()) {
  const data = { schema: BACKUP_SCHEMA, exportedAt: now, app: 'spellingbee', stores: {} };
  for (const name of STORES) {
    let rows = await db.getAll(name);
    if (name === 'settings') rows = rows.filter((r) => !SKIP_SETTINGS.has(r.key));
    if (name === 'wordlists') rows = rows.filter((l) => l.source === 'import');
    data.stores[name] = rows;
  }
  const d = new Date(now);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const filename = `spellingbee-backup-${stamp}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  return { blob, filename, data };
}

/**
 * Build the backup file ahead of time (e.g. when the Backup panel renders).
 * navigator.share must run inside the tap with no await before it, so the
 * IndexedDB reads have to happen first.
 * @returns {Promise<{file: File, blob: Blob, filename: string, preparedAt: number}>}
 */
export async function prepareBackup() {
  const { blob, filename } = await exportBackup();
  const file = new File([blob], filename, { type: 'application/json' });
  return { file, blob, filename, preparedAt: Date.now() };
}

/**
 * Call inside the tap with a backup from prepareBackup(). navigator.share is called
 * synchronously (no await before it), so the iPad share sheet opens (Save to Files /
 * AirDrop). Falls back to a download link when sharing files is unsupported.
 * Without `prepared` it still works, but the share sheet may be blocked because the
 * tap's user activation can expire while the backup is being read.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export function shareBackup(prepared) {
  if (!prepared) {
    return prepareBackup().then((p) => shareBackup(p));
  }
  const { file, blob, filename } = prepared;
  let pending;
  if (navigator.canShare?.({ files: [file] })) {
    pending = navigator.share({ files: [file], title: 'SpellQuest backup' }).then(
      () => 'shared',
      (err) => (err?.name === 'AbortError' ? 'cancelled' : downloadBlob(blob, filename)),
    );
  } else {
    pending = Promise.resolve(downloadBlob(blob, filename));
  }
  return pending.then(async (outcome) => {
    if (outcome !== 'cancelled') await setSetting('lastBackupAt', Date.now());
    return outcome;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export async function lastBackupAt() {
  return getSetting('lastBackupAt', null);
}

// ---- pure validation and merge ----------------------------------------------

export function validateBackup(data) {
  if (!data || data.schema !== BACKUP_SCHEMA || typeof data.stores !== 'object') {
    return { ok: false, reason: 'not-a-spellingbee-backup' };
  }
  for (const name of STORES) {
    if (data.stores[name] != null && !Array.isArray(data.stores[name])) return { ok: false, reason: `bad-store:${name}` };
  }
  const p = data.stores.progress ?? [];
  if (p.some((r) => !r || typeof r.profileId !== 'string' || typeof r.key !== 'string')) return { ok: false, reason: 'bad-progress' };
  const l = data.stores.ledger ?? [];
  if (l.some((r) => !r || typeof r.id !== 'string' || !Number.isFinite(r.tokens))) return { ok: false, reason: 'bad-ledger' };
  return { ok: true };
}

const RESOLVED = (e) => e?.status === 'added' || e?.status === 'declined';
const keyOf = (name, r) => (name === 'progress' ? `${r.profileId}\u0000${r.key}` : name === 'settings' ? r.key : r.id);

/** Merge rows of one store: incoming wins only when it is newer (or resolves a pending card). */
export function mergeRows(name, existing, incoming) {
  const out = new Map(existing.map((r) => [keyOf(name, r), r]));
  for (const r of incoming) {
    const k = keyOf(name, r);
    const cur = out.get(k);
    if (!cur) { out.set(k, r); continue; }
    let take = false;
    if (name === 'progress') take = (r.lastSeen ?? 0) > (cur.lastSeen ?? 0);
    else if (name === 'ledger') take = !RESOLVED(cur) && RESOLVED(r);
    else if (name === 'profiles') take = (r.updatedAt ?? 0) > (cur.updatedAt ?? 0);
    else if (name === 'wordlists') take = (r.importedAt ?? 0) > (cur.importedAt ?? 0);
    else if (name === 'settings') take = false; // keep this device's settings
    if (take) out.set(k, r);
  }
  return [...out.values()];
}

export async function importBackup(file, { mode = 'merge' } = {}, pin) {
  try { await requirePin(pin); } catch (e) { return { ok: false, reason: e.code ?? e.message }; }
  let data;
  try { data = JSON.parse(await file.text()); } catch { return { ok: false, reason: 'not-json' }; }
  const v = validateBackup(data);
  if (!v.ok) return v;
  const counts = {};
  for (const name of STORES) {
    let incoming = data.stores[name] ?? [];
    if (name === 'settings') incoming = incoming.filter((r) => !SKIP_SETTINGS.has(r.key));
    if (mode === 'replace') {
      const keep = name === 'settings' ? (await db.getAll('settings')).filter((r) => SKIP_SETTINGS.has(r.key)) : [];
      await db.clear(name);
      await db.putMany(name, [...keep, ...incoming]);
      counts[name] = incoming.length;
    } else {
      const merged = mergeRows(name, await db.getAll(name), incoming);
      await db.putMany(name, merged);
      counts[name] = merged.length;
    }
  }
  events.emit('profiles:changed', {});
  return { ok: true, counts };
}
