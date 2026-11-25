// Pure text helpers for clue display, including the ONE spelling-leak sanitizer (A1).
// Every clue string the screens show goes through maskWord()/leaksSpelling() here
// (via engine/clues.js), so a clue can never show the word it is asking about.

const SUFFIXES = ['s', 'es', 'd', 'ed', 'ing', 'er', 'ers', 'est', 'ly', 'ily', 'ness', 'ful', 'ment', 'ments',
  'ion', 'ions', 'ies', 'ied', 'ier', 'iest', 'able', 'ible', 'y', 'ie', 'ish', 'less', 'ism', 'ist', 'al', 'ic', "'s"]
  .map((s) => s.replace(/'/g, ''));
const VOWEL = /[aeiou]/i;
const MIN_CONTAINED = 5;   // a word this long is a leak anywhere inside another token (unfinished, resounding)
const MAX_RUN = 6;         // longest run of tokens joined when looking for split spellings (WIN-ter, A-ddis)

/** Lowercase letters only, accents folded: "Piñata" -> "pinata", "Addis Ababa" -> "addisababa". */
export function letterKey(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

/** Spelling stems the word can take before a suffix: accommodat(ing), happi(ly), stopp(ed). */
export function wordStems(word) {
  const w = letterKey(word);
  const out = [];
  if (w.length > 3 && /e$/.test(w)) out.push(w.slice(0, -1));
  if (w.length > 3 && /[^aeiou]y$/.test(w)) out.push(`${w.slice(0, -1)}i`);
  if (/[^aeiou][aeiou][b-df-hj-np-tv-z]$/.test(w) && !/[wxy]$/.test(w) && w.length >= 3) out.push(w + w.slice(-1));
  return out.filter((s) => s.length >= 3 && VOWEL.test(s));
}

/** Base forms of an inflected word: steps -> step, invited -> invite/invit, shivering -> shiver. */
export function baseForms(word) {
  const w = letterKey(word);
  const out = new Set();
  const add = (b) => { if (b.length >= 3 && VOWEL.test(b) && b !== w) out.add(b); };
  for (const suf of ['ing', 'ed', 'es', 's', 'er', 'est', 'ly', 'ies', 'ied', 'ness', 'ful', 'ment']) {
    if (w.length - suf.length < 3 || !w.endsWith(suf)) continue;
    const b = w.slice(0, -suf.length);
    if (suf === 's' && /(ss|us|is)$/.test(w)) continue;             // grass, versus, crisis are not plurals
    if (suf === 'ies' || suf === 'ied') { add(`${b}y`); continue; }
    add(b);
    if (/(ing|ed|er|est)$/.test(suf)) {
      add(`${b}e`);                                                  // invited -> invite
      if (/([b-df-hj-np-tv-z])\1$/.test(b)) add(b.slice(0, -1));     // stopped -> stop
    }
  }
  return [...out];
}

/** Every letter sequence that would reveal (most of) the spelling of `word`. */
function leakForms(word) {
  const w = letterKey(word);
  const roots = [w, ...baseForms(word)];
  const exact = new Set(roots);
  for (const r of roots) for (const s of SUFFIXES) exact.add(r + s);
  for (const st of [...wordStems(word), ...roots.flatMap((r) => wordStems(r))]) for (const s of SUFFIXES) exact.add(st + s);
  return { w, exact, contained: roots.filter((r) => r.length >= MIN_CONTAINED) };
}

function isLeakKey(key, forms) {
  if (!key) return false;
  if (forms.exact.has(key)) return true;
  if (forms.contained.some((r) => key.length > r.length && key.includes(r))) return true;
  // a root that is most of the word: moss (mossy), seven (seventy), Japan (Japanese), STIL (still)
  const { w } = forms;
  return w.length >= MIN_CONTAINED && key.length >= 4 && w.length - key.length <= 3 && w.startsWith(key);
}

/** Word-ish tokens with their positions; apostrophes inside a token are kept (don't, éclair's). */
function tokens(text) {
  const out = [];
  const re = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
  let m;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, key: letterKey(m[0]) });
  return out;
}

// Only these may sit between tokens that are joined into one spelling: spaces, hyphens, middle dots.
const JOINER = /^[\s\-‐‑–·•.'’]*$/;

/**
 * Spans [start,end) of `text` that reveal the spelling of `word`, longest first.
 * Catches the word, inflections (plurals, -ed/-ing, y->i, doubled consonant, dropped e),
 * base forms of an inflected word, the word inside a longer token, and the word split
 * across tokens ("WIN-ter", "ad dis a ba ba", respellings equal to the spelling).
 */
export function leakSpans(text, word) {
  const t = String(text ?? '');
  const forms = leakForms(word);
  if (!forms.w || !t) return [];
  const toks = tokens(t);
  const spans = [];
  for (let i = 0; i < toks.length; i++) {
    let joined = '';
    let best = -1;
    for (let j = i; j < toks.length && j < i + MAX_RUN; j++) {
      if (j > i && !JOINER.test(t.slice(toks[j - 1].end, toks[j].start))) break;
      joined += toks[j].key;
      if (joined.length > forms.w.length + 6) break;
      // single tokens are checked exactly; joined runs only count when they rebuild the whole word
      const hit = j === i ? isLeakKey(joined, forms) : (joined.length >= 3 && forms.exact.has(joined));
      if (hit) best = j;
    }
    if (best >= 0) { spans.push([toks[i].start, toks[best].end]); i = best; }
  }
  return spans;
}

export function leaksSpelling(text, word) {
  return leakSpans(text, word).length > 0;
}

/**
 * Hide the target word (and every close variant) in clue text:
 *   accommodate -> accommodated / accommodating / accommodation
 *   happy -> happily / happiness,  stop -> stopped,  steps -> step,  winter -> "WIN-ter"
 * Matching is case- and accent-insensitive and whole-token.
 */
export function maskWord(text, word, blank = '______') {
  if (!text || !word) return text ?? '';
  const t = String(text);
  const spans = leakSpans(t, word);
  if (!spans.length) return t;
  let out = '';
  let at = 0;
  for (const [s, e] of spans) { out += t.slice(at, s) + blank; at = e; }
  return out + t.slice(at);
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
