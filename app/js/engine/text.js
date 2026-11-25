// Pure text helpers for clue display.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUFFIX = '(?:s|es|d|ed|ing|er|ers|est|ly|ily|ness|ful|ment|ments|ion|ions|ies|ied|ier|iest|able|ible)';
const VOWEL = /[aeiou]/i;

function escapeLoose(s) {
  // escape regex chars; let hyphens/spaces/apostrophes in the word match any of them
  return escapeRe(s).replace(/(-|\s+|'|’)/g, "[-\\s'’]?");
}

/** Spelling stems the word can take before a suffix: accommodat(ing), happi(ly), stopp(ed). */
export function wordStems(word) {
  const w = String(word ?? '').trim();
  const out = [];
  if (w.length > 3 && /e$/i.test(w)) out.push(w.slice(0, -1));
  if (w.length > 3 && /[^aeiou]y$/i.test(w)) out.push(`${w.slice(0, -1)}i`);
  const m = /([^aeiou])([aeiou])([b-df-hj-np-tv-z])$/i.exec(w);
  if (m && !/[wxy]$/i.test(w) && w.length >= 3) out.push(w + w.slice(-1));
  return out.filter((s) => s.length >= 3 && VOWEL.test(s));
}

/**
 * Hide the target word (and its inflected forms) in clue text so the screen never
 * gives away the spelling:
 *   accommodate -> accommodated / accommodating / accommodation
 *   happy -> happily / happiness / happier,  stop -> stopped / stopping
 * Matching is case-insensitive and whole-word.
 */
export function maskWord(text, word, blank = '______') {
  if (!text || !word) return text ?? '';
  const w = String(word).trim();
  if (!w) return text;
  const alts = [`${escapeLoose(w)}${SUFFIX}?`, ...wordStems(w).map((st) => `${escapeLoose(st)}${SUFFIX}`)];
  const re = new RegExp(`(?<![A-Za-z])(?:${alts.join('|')})(?![A-Za-z])`, 'gi');
  return String(text).replace(re, blank);
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
