// Safe clue text (A1). The ONLY place screens should get clue strings from.
// Every string is run through the shared sanitizer in text.js: the word and its close
// variants are blanked, and a clue that would still give the spelling away is dropped
// or replaced with a hint that does not contain the word.
import { leaksSpelling, letterKey, maskWord } from './text.js';

export const BLANK = '______';

/** Clue kinds a screen can show. 'respell' and 'syllables' are display-only hints. */
export const SAFE_CLUE_KINDS = ['definition', 'sentence', 'partOfSpeech', 'origin', 'altPronunciation', 'syllables', 'respell'];

const SAME_NAME_ORIGIN = 'It comes from a language that has the same name as this word.';

function hasLetters(s) {
  return /[a-z]/i.test(String(s ?? '').replace(new RegExp(BLANK, 'g'), ''));
}

/**
 * Mask `text` for `word`, then verify. Returns the masked text, or '' when nothing useful
 * is left (e.g. the whole clue was the word) or a leak somehow survives.
 */
export function sanitizeClue(text, word) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const target = typeof word === 'object' ? word?.word : word;
  if (!letterKey(target)) return raw;
  const forms = [target, ...(typeof word === 'object' ? (word.accept ?? []) : [])];
  let out = raw;
  for (const f of forms) out = maskWord(out, f, BLANK);
  if (forms.some((f) => leaksSpelling(out, f))) return '';
  return hasLetters(out) ? out : '';
}

function syllableDots(word) {
  const parts = String(word?.syllables || '').split(/[·\-.\s]+/).filter(Boolean);
  return parts.length ? `${parts.length} syllables: ${parts.map((p) => '●'.repeat(p.length)).join(' · ')}` : '';
}

/**
 * Safe display text for one clue of a word ('' = do not show this clue).
 * @param {object} word normalized word record
 * @param {'definition'|'sentence'|'partOfSpeech'|'origin'|'altPronunciation'|'syllables'|'respell'} kind
 */
export function clueText(word, kind) {
  if (!word) return '';
  switch (kind) {
    case 'definition':
      return sanitizeClue(word.definitions?.[0], word);
    case 'sentence':
      return sanitizeClue(word.sentence, word);
    case 'partOfSpeech':
      return sanitizeClue(word.partOfSpeech, word);
    case 'origin': {
      if (!word.origin) return '';
      const safe = sanitizeClue(word.origin, word);
      // "Krio" comes from Krio: say so without spelling it.
      return safe || SAME_NAME_ORIGIN;
    }
    case 'altPronunciation':
      return sanitizeClue(word.altPronunciation, word);
    case 'respell':
      // RAN for "ran", WIN-ter for "winter": a respelling equal to the spelling is never shown.
      // A respelling that shares any spelled piece with the word (SIL-ee for "silly") is dropped, not masked.
      return [word.word, ...(word.accept ?? [])].some((f) => leaksSpelling(word.audio?.respell, f))
        ? '' : sanitizeClue(word.audio?.respell, word);
    case 'syllables':
      return syllableDots(word);
    default:
      return '';
  }
}

/** True when the clue exists AND can be shown without revealing the spelling. */
export function hasSafeClue(word, kind) {
  return clueText(word, kind) !== '';
}

/** All safe clues for a word: { definition: '...', sentence: '...', ... } (missing kinds omitted). */
export function safeClues(word) {
  const out = {};
  for (const k of SAFE_CLUE_KINDS) { const t = clueText(word, k); if (t) out[k] = t; }
  return out;
}

/**
 * Text for any caption, toast or aria-label that may mention clue content. Use for anything
 * that is not one of the clue kinds above (e.g. a coach tip built from word data).
 */
export function safeCaption(text, word) {
  return sanitizeClue(text, word);
}

/**
 * Exactly what is SPOKEN for a clip kind (not masked: the judge says the word out loud).
 * bee-eng's audio pipeline records these strings, and speech.js speaks the same strings
 * with the device voice when a clip is missing, so both paths say the same thing.
 * @param {'word'|'definition'|'sentence'|'origin'|'partOfSpeech'|'altPronunciation'} kind
 */
export function spokenText(word, kind) {
  const w = word ?? {};
  switch (kind) {
    case 'word': return w.audio?.sayAs || w.word || '';
    case 'definition': return w.definitions?.length ? `Definition: ${w.definitions[0]}` : '';
    case 'sentence': return w.sentence || '';
    case 'origin': return w.origin ? `Language of origin: ${w.origin}.` : '';
    case 'partOfSpeech': return w.partOfSpeech ? `Part of speech: ${w.partOfSpeech}.` : '';
    case 'altPronunciation': return w.altPronunciation ? `Another pronunciation: ${w.altPronunciation}.` : '';
    default: return '';
  }
}
