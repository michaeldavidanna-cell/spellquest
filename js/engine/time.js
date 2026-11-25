// Pure date helpers. "Day" means the device's local calendar day.
export const DAY_MS = 86_400_000;

export function localDay(now = Date.now()) {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Parse 'YYYY-MM-DD' as local midnight. Returns NaN when invalid. */
export function parseDay(str) {
  if (typeof str !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** Whole calendar days from `from` (ms) to `to` (ms); DST-safe via rounding. */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** Midnight `n` local days after the day containing `now`. */
export function addDays(now, n) {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Start of the local week (Monday) containing `now`. */
export function startOfWeek(now = Date.now()) {
  const d = new Date(startOfDay(now));
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
