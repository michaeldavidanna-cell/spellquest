// Pure word-list normalizer for schema spellingbee.wordlist/1 (T1 §2).
// Also accepts the raw OCR draft array [{word, source_image, confidence}].

export const WORDLIST_SCHEMA = 'spellingbee.wordlist/1';
export const CLUE_KINDS = ['definition', 'sentence', 'partOfSpeech', 'origin', 'altPronunciation', 'syllables'];

export function wordKey(word) {
  return String(word ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function strArray(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
}

export function normalizeWord(raw, listId, index = 0) {
  if (typeof raw === 'string') raw = { word: raw };
  const word = str(raw?.word);
  if (!word) return null;
  const key = wordKey(word);
  const audio = raw.audio && typeof raw.audio === 'object' ? raw.audio : {};
  return {
    key,
    id: str(raw.id) || `w${String(index + 1).padStart(4, '0')}`,
    listId,
    word,
    accept: [...new Set([word, ...strArray(raw.accept)])],
    grade: raw.grade == null ? null : clampInt(raw.grade, 0, 12, null),
    difficulty: clampInt(raw.difficulty, 1, 5, 3),
    partOfSpeech: str(raw.partOfSpeech),
    definitions: strArray(raw.definitions ?? raw.definition),
    sentence: str(raw.sentence),
    origin: str(raw.origin),
    altPronunciation: str(raw.altPronunciation),
    audio: {
      sayAs: str(audio.sayAs),
      respell: str(audio.respell),
      ipa: str(audio.ipa),
      file: str(audio.file) || null,
    },
    homophones: strArray(raw.homophones),
    tags: strArray(raw.tags),
    syllables: str(raw.syllables),
    reviewed: raw.reviewed === true,
    ocr: raw.ocr ?? (raw.source_image ? { file: raw.source_image, confidence: raw.confidence ?? null } : null),
  };
}

/**
 * @param {object|Array} raw parsed JSON
 * @param {{id?:string, source?:string}} hint fallback id (e.g. file name) and origin ('builtin'|'import')
 */
export function normalizeWordList(raw, { id = 'list', source = 'builtin' } = {}) {
  const isArray = Array.isArray(raw);
  if (!isArray && (!raw || typeof raw !== 'object' || !Array.isArray(raw.words))) {
    throw new Error('Not a word list: expected {"words":[...]} or an array of words');
  }
  if (!isArray && raw.schema && raw.schema !== WORDLIST_SCHEMA) {
    throw new Error(`Unsupported word-list schema: ${raw.schema}`);
  }
  const listId = str(isArray ? '' : raw.id) || id;
  const seen = new Set();
  const words = [];
  (isArray ? raw : raw.words).forEach((w, i) => {
    const n = normalizeWord(w, listId, i);
    if (n && !seen.has(n.key)) { seen.add(n.key); words.push(n); }
  });
  return {
    schema: WORDLIST_SCHEMA,
    id: listId,
    title: str(isArray ? '' : raw.title) || listId,
    beeDate: str(isArray ? '' : raw.beeDate) || null,
    grade: isArray || raw.grade == null ? null : clampInt(raw.grade, 0, 12, null),
    source,
    words,
  };
}

export function hasClue(word, kind) {
  if (!word) return false;
  switch (kind) {
    case 'definition': return word.definitions?.length > 0;
    case 'sentence': return !!word.sentence;
    case 'partOfSpeech': return !!word.partOfSpeech;
    case 'origin': return !!word.origin;
    case 'altPronunciation': return !!word.altPronunciation;
    case 'syllables': return !!word.syllables;
    default: return false;
  }
}

/**
 * R4: which lists a kid studies when the parent has not picked any (wordListIds empty).
 * Practice (3rd grader) gets the lists marked grade <= 4; competition (the bee) gets the
 * other lists (no grade, or grade >= 5). If that leaves nothing, every list is used.
 */
export function defaultListIds(lists, mode) {
  const easy = (l) => l.grade != null && l.grade <= 4;
  const pick = mode === 'practice' ? lists.filter(easy) : mode === 'competition' ? lists.filter((l) => !easy(l)) : [];
  return (pick.length ? pick : lists).map((l) => l.id);
}

/** Merge lists into one word array for a profile; first list wins on duplicate keys. */
export function mergeWords(lists, wordListIds = []) {
  const chosen = wordListIds?.length ? lists.filter((l) => wordListIds.includes(l.id)) : lists;
  const out = new Map();
  for (const l of chosen) for (const w of l.words) if (!out.has(w.key)) out.set(w.key, w);
  return [...out.values()];
}

/** Earliest upcoming bee date among the lists (YYYY-MM-DD) or null. */
export function beeDateFor(lists, wordListIds = [], todayStr = '') {
  const chosen = wordListIds?.length ? lists.filter((l) => wordListIds.includes(l.id)) : lists;
  const dates = chosen.map((l) => l.beeDate).filter((d) => d && (!todayStr || d >= todayStr)).sort();
  return dates[0] ?? null;
}
