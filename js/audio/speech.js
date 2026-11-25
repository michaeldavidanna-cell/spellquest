// Speech for iPadOS Safari / Home Screen web app (T2 §1).
//  - Every speak call is synchronous and must run inside the user's tap.
//  - Voices are read on each call (getVoices() can be empty until a gesture and
//    'voiceschanged' may never fire), then filtered at runtime.
//  - Utterances stay referenced until they end (WebKit can drop unreferenced ones).
//  - A watchdog reports 'stalled' when audio never starts or never ends, so the
//    screen can show a big "Tap to hear it again" button that calls replay().
//  - No speech recognition is used anywhere (T2: it breaks speaking on iPadOS 27).
//  - A1: recorded natural-voice clips (audio/clips.js) play FIRST through one reusable
//    HTMLAudioElement started inside the tap (unlocked on the first tap anywhere). The device
//    voice is used only for parts that have no clip, or when a clip fails to play.
import { events } from '../store/events.js';
import { phonicsSayAs } from '../engine/phonics.js';
import { spokenText } from '../engine/clues.js';
import { clipUrl, loadAudioManifests } from './clips.js';

const VOICE_KEY = 'spellingbee.voice';
const NOVELTY = /eloquence|eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley|superstar|albert|bahh|bells|boing|bubbles|cellos|deranged|jester|organ|trinoids|whisper|zarvox|bad news|good news|hysterical|wobble|junior|ralph|fred|kathy/i;
const LEAST_COMIC = /reed|sandy/i;
const PREFERRED = /samantha|ava|allison|nicky|evan|susan|tom|zoe|joelle|nathan|noelle/i;

export const RATES = { word: 0.85, slow: 0.6, clue: 0.95, letters: 0.8 };
const START_TIMEOUT_MS = 1800;
const CLIP_START_TIMEOUT_MS = 2500; // a clip that has not started by then falls back to the device voice
const CLIP_SLOW = 0.75;             // playbackRate for "Slow" on a recorded clip (pitch preserved)

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const live = new Set();          // keep utterances alive until onend
let lastParts = [];
let current = 'idle';
let startWatch = null;
let endWatch = null;
let chosen = null;               // SpeechSynthesisVoice
let wordRate = RATES.word;
const recordings = new Map();    // letter -> HTMLAudioElement
let gen = 0;                     // bumps on every new speak/stop; stale callbacks check it
let audioEl = null;              // the one reusable clip player
let audioUnlocked = false;
const badClips = new Set();      // clips that errored (404/decode): use the voice for them at once

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

function getAudio() {
  if (!audioEl && typeof Audio !== 'undefined') {
    audioEl = new Audio();
    audioEl.preload = 'auto';
    audioEl.setAttribute?.('playsinline', '');
  }
  return audioEl;
}

function stopAudio() {
  if (!audioEl) return;
  audioEl.onplaying = audioEl.onended = audioEl.onerror = audioEl.onloadedmetadata = null;
  try { audioEl.pause(); } catch { /* ignore */ }
}

function partText(p) { return String(p?.text ?? '').trim(); }

/** Device-voice part(s): speak synchronously; `then` runs when the last one ends. */
function ttsRun(parts, g, fullText, then) {
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    setState('novoice', fullText);
    return false;
  }
  if (!chosen || !voices().some((v) => v.voice === chosen)) chosen = pickVoice();
  // Interrupt what is playing. A stuck 'speaking' flag is cleared by cancel(), and
  // every utterance below is NEW (never resubmit an already-queued utterance).
  if (synth.speaking || synth.pending) synth.cancel();
  if (synth.paused) synth.resume();
  live.clear();

  let started = false;
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(partText(p));
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = 'en-US'; }
    u.rate = p.rate ?? RATES.clue;
    u.pitch = 1;
    u.volume = 1;
    u.onstart = () => {
      if (g !== gen) return;
      if (!started) { started = true; clearTimeout(startWatch); setState('speaking', fullText); }
    };
    const done = () => {
      live.delete(u);
      if (g !== gen) return;
      if (i === parts.length - 1 || live.size === 0) { clearWatch(); then(); }
    };
    u.onend = done;
    u.onerror = (e) => {
      live.delete(u);
      if (g !== gen) return;
      // 'interrupted'/'canceled' happen when we cancel on purpose; anything else is a failure.
      if (e?.error && e.error !== 'interrupted' && e.error !== 'canceled') { clearWatch(); setState('stalled', fullText); }
      else if (live.size === 0) { clearWatch(); then(); }
    };
    live.add(u);
    synth.speak(u);
  });

  // Watchdogs: audio never started (lost gesture, app switch, iPadOS 27 cancel bug) or never ended.
  clearWatch();
  startWatch = setTimeout(() => { if (g === gen && !started) setState('stalled', fullText); }, START_TIMEOUT_MS);
  const expectedMs = parts.reduce((ms, p) => ms + (partText(p).length * 90) / (p.rate ?? 1), 0);
  endWatch = setTimeout(() => {
    if (g === gen && live.size) { synth.cancel(); live.clear(); setState('stalled', fullText); }
  }, expectedMs + 8000);
  return true;
}

/** Recorded clip part: start synchronously; falls back to the device voice on failure. */
function clipRun(p, g, fullText, then) {
  const a = getAudio();
  let failed = false;
  const fallback = () => {
    if (g !== gen || failed) return; // error event and play() rejection can both arrive: fall back once
    failed = true;
    stopAudio();
    clearWatch();
    if (partText(p)) ttsRun([{ text: p.text, rate: p.ttsRate }], g, fullText, then); else then();
  };
  if (!a) return fallback();
  if (synth && (synth.speaking || synth.pending)) synth.cancel();
  stopAudio();
  clearWatch();
  let started = false;
  a.onplaying = () => {
    if (g !== gen) return;
    if (!started) { started = true; clearTimeout(startWatch); setState('speaking', fullText); }
  };
  a.onloadedmetadata = () => {
    if (g !== gen || !Number.isFinite(a.duration)) return;
    clearTimeout(endWatch);
    endWatch = setTimeout(() => { if (g === gen) { stopAudio(); setState('stalled', fullText); } },
      (a.duration * 1000) / (p.rate || 1) + 6000);
  };
  a.onended = () => { if (g !== gen) return; clearWatch(); stopAudio(); then(); };
  a.onerror = () => { if (g !== gen) return; badClips.add(p.clip); fallback(); };
  a.src = p.clip;
  a.playbackRate = p.rate || 1;
  a.defaultPlaybackRate = p.rate || 1;
  a.preservesPitch = true;
  a.webkitPreservesPitch = true;
  let playing;
  try { playing = a.play(); } catch { return fallback(); }
  // NotAllowedError (not unlocked yet) or a decode problem: use the device voice for this part.
  playing?.catch?.((err) => { if (g === gen && err?.name !== 'AbortError') fallback(); });
  startWatch = setTimeout(() => { if (g === gen && !started) fallback(); }, CLIP_START_TIMEOUT_MS);
  return true;
}

/**
 * Core: play parts in order, synchronously starting the first one inside the caller's tap.
 * A part is {text, rate} (device voice) or {clip, rate, text, ttsRate} (recording, with the
 * text as its fallback). Consecutive voice parts are queued together.
 */
function speakParts(parts) {
  parts = parts.filter((p) => p && ((p.clip && !badClips.has(p.clip)) || partText(p)))
    .map((p) => (p.clip && badClips.has(p.clip) ? { text: p.text, rate: p.ttsRate } : p));
  if (!parts.length) return false;
  lastParts = parts;
  const g = ++gen;
  clearWatch();
  stopAudio();
  const fullText = parts.map(partText).filter(Boolean).join(' ');
  const step = (i) => {
    if (g !== gen) return;
    if (i >= parts.length) { clearWatch(); setState('idle'); return; }
    if (parts[i].clip) { clipRun(parts[i], g, fullText, () => step(i + 1)); return; }
    let j = i;
    while (j < parts.length && !parts[j].clip) j++;
    ttsRun(parts.slice(i, j), g, fullText, () => step(j));
  };
  // Nothing may be awaited before the first part: it must start inside the tap.
  const first = parts[0];
  if (!first.clip && (!synth || typeof SpeechSynthesisUtterance === 'undefined') && !parts.some((p) => p.clip)) {
    setState('novoice', fullText);
    return false;
  }
  step(0);
  return true;
}

/** One part for a word field: the clip when it exists, else the device voice. */
function fieldPart(word, kind, rate, { slow = false } = {}) {
  const text = spokenText(word, kind);
  const clip = clipUrl(word, kind);
  if (clip) {
    const base = slow ? CLIP_SLOW : (kind === 'word' ? Math.max(0.5, Math.min(1.5, wordRate / RATES.word)) : 1);
    return { clip, rate: base, text, ttsRate: rate };
  }
  return text ? { text, rate } : null;
}

// ---- Public API (all synchronous; call inside a tap) -----------------------

export function say(text, { rate = RATES.clue } = {}) {
  return speakParts([{ text, rate }]);
}

export function sayWord(word, { slow = false } = {}) {
  return speakParts([fieldPart(word, 'word', slow ? RATES.slow : wordRate, { slow })]);
}

function clueParts(word, kind) {
  switch (kind) {
    case 'definition':
    case 'sentence':
    case 'origin':
    case 'partOfSpeech':
      return [fieldPart(word, kind, RATES.clue)];
    case 'altPronunciation':
      return [fieldPart(word, kind, wordRate)];
    case 'all':
      return ['partOfSpeech', 'definition', 'origin', 'sentence'].flatMap((k) => clueParts(word, k));
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
  return speakParts([
    fieldPart(word, 'word', wordRate),
    { text: lettersText(word?.word), rate: RATES.letters },
    fieldPart(word, 'word', wordRate),
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
    gen++;
    stopAudio();
    clearWatch();
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
  gen++;
  clearWatch();
  stopAudio();
  if (synth && (synth.speaking || synth.pending)) synth.cancel();
  live.clear();
  setState('idle');
}

/** "Tap to hear it again": a fresh set of utterances for the last thing said. */
export function replay() {
  if (!lastParts.length) return false;
  if (synth && current === 'stalled') synth.cancel();
  stopAudio();
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
      const wasSpeaking = live.size > 0 || (audioEl && !audioEl.paused && !audioEl.ended);
      gen++;
      clearWatch();
      stopAudio();
      if (synth && (synth.speaking || synth.pending)) synth.cancel();
      live.clear();
      if (wasSpeaking) setState('stalled', lastParts.map(partText).join(' '));
    }
  });
}

function silentWav() {
  const n = 16;
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const tag = (o, t) => { for (let i = 0; i < 4; i++) b[o + i] = t.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, n * 2, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`;
}

/**
 * Call from the first tap anywhere (main.js does this on every pointerdown; it is cheap).
 * Populates the voice list and, once, plays a silent sound on the clip player so later
 * clips are allowed to play on iPadOS.
 */
export function unlock() {
  if (synth) {
    synth.getVoices();
    chosen = chosen ?? pickVoice();
  }
  if (audioUnlocked) return;
  const a = getAudio();
  if (!a || (!a.paused && !a.ended)) return;
  try {
    a.src = silentWav();
    const p = a.play();
    audioUnlocked = true;
    p?.then?.(() => {}, (err) => { if (err?.name === 'NotAllowedError') audioUnlocked = false; });
  } catch { /* try again on the next tap */ }
}

/** Load clip manifests for these word lists (main.js calls this at boot and on list changes). */
export function loadClips(listIds) {
  return loadAudioManifests(listIds);
}

export const speech = {
  say, sayWord, sayClue, sayLetters, sayLetter, sayWordSpelled, sayPhonics, stop, replay, state,
  voices: () => voices().map(({ name, lang, local, novelty }) => ({ name, lang, local, novelty })),
  setVoice, currentVoice, setWordRate, unlock, initPhonicsRecordings, lettersText, loadClips,
  hasClip: (word, kind) => !!clipUrl(word, kind),
};
export default speech;
