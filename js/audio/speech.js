// Speech for iPadOS Safari / Home Screen web app (T2 §1).
//  - Every speak call is synchronous and must run inside the user's tap.
//  - Voices are read on each call (getVoices() can be empty until a gesture and
//    'voiceschanged' may never fire), then filtered at runtime.
//  - Utterances stay referenced until they end (WebKit can drop unreferenced ones).
//  - A watchdog reports 'stalled' when audio never starts or never ends, so the
//    screen can show a big "Tap to hear it again" button that calls replay().
//  - No speech recognition is used anywhere (T2: it breaks speaking on iPadOS 27).
import { events } from '../store/events.js';
import { phonicsSayAs } from '../engine/phonics.js';

const VOICE_KEY = 'spellingbee.voice';
const NOVELTY = /eloquence|eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley|superstar|albert|bahh|bells|boing|bubbles|cellos|deranged|jester|organ|trinoids|whisper|zarvox|bad news|good news|hysterical|wobble|junior|ralph|fred|kathy/i;
const LEAST_COMIC = /reed|sandy/i;
const PREFERRED = /samantha|ava|allison|nicky|evan|susan|tom|zoe|joelle|nathan|noelle/i;

export const RATES = { word: 0.85, slow: 0.6, clue: 0.95, letters: 0.8 };
const START_TIMEOUT_MS = 1800;

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const live = new Set();          // keep utterances alive until onend
let lastParts = [];
let current = 'idle';
let startWatch = null;
let endWatch = null;
let chosen = null;               // SpeechSynthesisVoice
let wordRate = RATES.word;
const recordings = new Map();    // letter -> HTMLAudioElement

function setState(state, text = '') {
  if (state === current && state !== 'stalled') return;
  current = state;
  events.emit('speech:state', { state, text });
}

function langRank(lang = '') {
  const l = lang.replace('_', '-').toLowerCase();
  if (l.startsWith('en-us')) return 0;
  if (l.startsWith('en-gb')) return 1;
  if (l.startsWith('en')) return 2;
  return 9;
}

/** Filtered English voices, best first. Safe to call any time. */
export function voices() {
  const all = synth?.getVoices?.() ?? [];
  const seen = new Set();
  return all
    .filter((v) => langRank(v.lang) < 9)
    .filter((v) => { const k = `${v.name}|${v.lang}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((v) => ({ voice: v, name: v.name, lang: v.lang, local: v.localService !== false, novelty: NOVELTY.test(v.name) }))
    .sort((a, b) => (a.novelty - b.novelty) || (langRank(a.lang) - langRank(b.lang))
      || (PREFERRED.test(b.name) - PREFERRED.test(a.name)) || (b.local - a.local));
}

function pickVoice() {
  const list = voices();
  if (!list.length) return null;
  let pref = null;
  try { pref = localStorage.getItem(VOICE_KEY); } catch { /* ignore */ }
  if (pref) { const m = list.find((v) => v.name === pref); if (m) return m.voice; }
  const good = list.find((v) => !v.novelty);
  if (good) return good.voice;
  return (list.find((v) => LEAST_COMIC.test(v.name)) ?? list[0]).voice;
}

export function setVoice(name) {
  try { if (name) localStorage.setItem(VOICE_KEY, name); else localStorage.removeItem(VOICE_KEY); } catch { /* ignore */ }
  chosen = null;
  chosen = pickVoice();
}

export function currentVoice() {
  if (!chosen) chosen = pickVoice();
  return chosen ? { name: chosen.name, lang: chosen.lang, local: chosen.localService !== false } : null;
}

export function setWordRate(rate) {
  if (Number.isFinite(rate) && rate > 0.3 && rate <= 1.5) wordRate = rate;
}

function clearWatch() {
  clearTimeout(startWatch); clearTimeout(endWatch);
  startWatch = endWatch = null;
}

/** Core: speak parts [{text, rate}] synchronously, inside the caller's tap. */
function speakParts(parts) {
  parts = parts.filter((p) => p && p.text && String(p.text).trim());
  if (!parts.length) return false;
  lastParts = parts;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    setState('novoice', parts.map((p) => p.text).join(' '));
    return false;
  }
  if (!chosen || !voices().some((v) => v.voice === chosen)) chosen = pickVoice();

  // Interrupt what is playing. A stuck 'speaking' flag is cleared by cancel(), and
  // every utterance below is NEW (never resubmit an already-queued utterance).
  if (synth.speaking || synth.pending) synth.cancel();
  if (synth.paused) synth.resume();
  clearWatch();
  live.clear();

  let started = false;
  const fullText = parts.map((p) => p.text).join(' ');
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(String(p.text));
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = 'en-US'; }
    u.rate = p.rate ?? RATES.clue;
    u.pitch = 1;
    u.volume = 1;
    u.onstart = () => {
      if (!started) { started = true; clearTimeout(startWatch); setState('speaking', fullText); }
    };
    const done = () => {
      live.delete(u);
      if (i === parts.length - 1 || live.size === 0) { clearWatch(); setState('idle'); }
    };
    u.onend = done;
    u.onerror = (e) => {
      live.delete(u);
      // 'interrupted'/'canceled' happen when we cancel on purpose; anything else is a failure.
      if (e?.error && e.error !== 'interrupted' && e.error !== 'canceled') { clearWatch(); setState('stalled', fullText); }
      else if (live.size === 0) { clearWatch(); setState('idle'); }
    };
    live.add(u);
    synth.speak(u);
  });

  // Watchdogs: audio never started (lost gesture, app switch, iPadOS 27 cancel bug) or never ended.
  startWatch = setTimeout(() => { if (!started) setState('stalled', fullText); }, START_TIMEOUT_MS);
  const expectedMs = parts.reduce((ms, p) => ms + (String(p.text).length * 90) / (p.rate ?? 1), 0);
  endWatch = setTimeout(() => {
    if (live.size) { synth.cancel(); live.clear(); setState('stalled', fullText); }
  }, expectedMs + 8000);
  return true;
}

// ---- Public API (all synchronous; call inside a tap) -----------------------

export function say(text, { rate = RATES.clue } = {}) {
  return speakParts([{ text, rate }]);
}

export function sayWord(word, { slow = false } = {}) {
  const text = word?.audio?.sayAs || word?.word || '';
  return speakParts([{ text, rate: slow ? RATES.slow : wordRate }]);
}

function clueParts(word, kind) {
  const w = word ?? {};
  switch (kind) {
    case 'definition':
      return w.definitions?.length ? [{ text: `Definition: ${w.definitions[0]}`, rate: RATES.clue }] : [];
    case 'sentence':
      return w.sentence ? [{ text: w.sentence, rate: RATES.clue }] : [];
    case 'partOfSpeech':
      return w.partOfSpeech ? [{ text: `Part of speech: ${w.partOfSpeech}.`, rate: RATES.clue }] : [];
    case 'origin':
      return w.origin ? [{ text: `Language of origin: ${w.origin}.`, rate: RATES.clue }] : [];
    case 'altPronunciation':
      return w.altPronunciation ? [{ text: `Another pronunciation: ${w.altPronunciation}.`, rate: wordRate }] : [];
    case 'all':
      return ['partOfSpeech', 'definition', 'origin', 'sentence'].flatMap((k) => clueParts(w, k));
    default:
      return [];
  }
}

export function sayClue(word, kind) {
  return speakParts(clueParts(word, kind));
}

/** Letter names as uppercase with periods ("R. H. Y.") so voices say names, not sounds. */
export function lettersText(str) {
  return [...String(str ?? '').replace(/[^a-z'-]/gi, '')]
    .map((c) => (c === '-' ? 'hyphen' : c === "'" ? 'apostrophe' : `${c.toUpperCase()}.`))
    .join(' ');
}

export function sayLetters(str) {
  return speakParts([{ text: lettersText(str), rate: RATES.letters }]);
}

export function sayLetter(ch) {
  return speakParts([{ text: lettersText(ch), rate: 1 }]);
}

/** Spell-back after an answer: "rhythm. R. H. Y. T. H. M. rhythm." */
export function sayWordSpelled(word) {
  const text = word?.audio?.sayAs || word?.word || '';
  return speakParts([
    { text, rate: wordRate },
    { text: lettersText(word?.word), rate: RATES.letters },
    { text, rate: wordRate },
  ]);
}

/**
 * Load the optional recorded letter sounds listed in audio/phonics/index.json
 * ({"files":{"a":"a.m4a",...}}). Called once at boot; failures are silent.
 */
export async function initPhonicsRecordings() {
  try {
    const base = new URL('../../audio/phonics/', import.meta.url);
    const res = await fetch(new URL('index.json', base));
    if (!res.ok) return 0;
    const { files = {} } = await res.json();
    for (const [letter, file] of Object.entries(files)) {
      const a = new Audio(new URL(file, base).href);
      a.preload = 'auto';
      recordings.set(letter.toLowerCase(), a);
    }
    return recordings.size;
  } catch { return 0; }
}

export function sayPhonics(letter) {
  const l = String(letter ?? '').toLowerCase();
  const rec = recordings.get(l);
  if (rec) {
    if (synth?.speaking) synth.cancel();
    try {
      rec.currentTime = 0;
      lastParts = [];
      const p = rec.play();
      p?.catch?.(() => speakParts([{ text: phonicsSayAs(l), rate: RATES.letters }]));
      return true;
    } catch { /* fall back to TTS */ }
  }
  return speakParts([{ text: phonicsSayAs(l), rate: RATES.letters }]);
}

export function stop() {
  clearWatch();
  if (synth && (synth.speaking || synth.pending)) synth.cancel();
  live.clear();
  setState('idle');
}

/** "Tap to hear it again": a fresh set of utterances for the last thing said. */
export function replay() {
  if (!lastParts.length) return false;
  if (synth && current === 'stalled') synth.cancel();
  chosen = null; // re-read the voice list; it may have changed after an app switch
  return speakParts(lastParts);
}

export function state() {
  if (!synth) return 'novoice';
  return current;
}

// Leaving the app mid-word can leave WebKit's synthesizer silent: stop cleanly and
// let the screen offer replay when the child returns.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const wasSpeaking = live.size > 0;
      clearWatch();
      if (synth && (synth.speaking || synth.pending)) synth.cancel();
      live.clear();
      if (wasSpeaking) setState('stalled', lastParts.map((p) => p.text).join(' '));
    }
  });
}

/** Call from the first tap anywhere (main.js does this) so the voice list is populated. */
export function unlock() {
  if (!synth) return;
  synth.getVoices();
  chosen = chosen ?? pickVoice();
}

export const speech = {
  say, sayWord, sayClue, sayLetters, sayLetter, sayWordSpelled, sayPhonics, stop, replay, state,
  voices: () => voices().map(({ name, lang, local, novelty }) => ({ name, lang, local, novelty })),
  setVoice, currentVoice, setWordRate, unlock, initPhonicsRecordings, lettersText,
};
export default speech;
