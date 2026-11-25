# App core API (bee-arch)

## Changed in A1 (clue leak, recorded audio, phonics ladder)

The app `VERSION` is **0.2.0** in `sw.js` and `main.js`.

| # | Change | What screens / bee-eng should do |
|---|---|---|
| 1 | **One clue sanitizer.** New `engine/clues.js`: `clueText(word, kind)` returns text that never shows the spelling, or `''`. Kinds: `definition`, `sentence`, `partOfSpeech`, `origin`, `altPronunciation`, `syllables`, `respell`. `hasSafeClue(word, kind)`, `safeClues(word)`, `safeCaption(text, word)` (for any other caption or toast built from word data). `maskWord` in `engine/text.js` is now the same sanitizer: it blanks the word, plurals, -ed/-ing, y→i, doubled consonant, dropped e, base forms (steps→step), roots that are most of the word (moss for mossy, Japan for Japanese), the word inside a longer token (unfinished), and the word split across tokens ("WIN-ter", respellings). A respelling that shares any spelled piece with the word is never shown. Same-name origins ("Krio" from Krio) show *"It comes from a language that has the same name as this word."* | **Show clue text only from `clueText()`**, never from raw word fields. Gate buttons with `hasSafeClue()` (not `hasClue()`). Practice and On Stage are already switched (I edited only their clue functions and the import line). Peek and the after-answer reveal still show the word on purpose. |
| 2 | **Retry no longer shows the answer.** When a Practice miss will be retried, `submit()` returns `target: null`, `revealed: false`, empty `patterns`, and `targetMarks` as `_` blanks (same length, same `ok` flags). The child sees which of *their* letters were right. The final result (correct, or the second miss) has `revealed: true` and the full target, as before. | Nothing (`renderLetterDiff` already draws blanks). Don't read `word.word` to fill the retry row. |
| 3 | **Recorded clips first.** `audio/clips.js` plus `speech.js`. Every `speech.sayWord / sayClue / sayWordSpelled / replay` call plays a recorded natural-voice clip when one exists, started synchronously in the tap through one reusable `HTMLAudioElement` (unlocked by the first tap anywhere; `main.js` already calls `speech.unlock()` on pointerdown). The device voice is used only for parts with no clip, or when a clip fails (once, never twice), so "Part of speech" and spelled-out letters stay on the device voice. "Slow" plays the clip at 0.75× with pitch kept. The `speech:state` events and the "Voice paused" replay work the same. New: `speech.hasClip(word, kind)` and `speech.loadClips(listIds)` (`main.js` calls it at boot and on `wordlists:changed`). | Nothing required. Optional: a small "natural voice" badge when `speech.hasClip(word,'word')`. |
| 4 | **Offline audio: parent action.** `import { downloadAllAudio, audioStatus, clearAudio } from './audio/clips.js'`. `downloadAllAudio({ onProgress({done,total,failed}), signal })` resolves `{ok, total, done, failed, aborted, reason?}`, where `reason` is one of `'no-audio' \| 'storage-full' \| 'no-cache-storage'`. It resumes if called again, and a second call while running returns the same promise. `audioStatus()` resolves `{total, cached}`. `clearAudio()` deletes the clips (they come back as they are played). | **bee-ui:** add a Parent-area button *"Download all audio for offline"* with a progress bar (`done/total`), a Cancel button (`AbortController`), and the status line *"N of M clips saved on this iPad"* from `audioStatus()`. Ask for Wi-Fi (it is many MB). No PIN needed (it only downloads the app's own files). |
| 5 | **Service worker.** Clips are **not** precached. Each one is cached in `spellingbee-audio` (unversioned, kept across app updates) the first time it plays, or by `downloadAllAudio`. Safari's media Range requests get a `206` from the cached file. | Nothing. |
| 6 | **Phonics ladder** (`data/phonics.json`, `engine/phonics.js`, `store/phonics.js`). 9 levels, 581 items: letter names (52), letter sounds (91), rhyming (92), CVC words (101), digraphs sh/ch/th/wh/ck (44), blends (58), Dolch pre-primer (40), Dolch primer (52), two-word phrases (54). The level is derived from progress: a level is mastered when 80% of its items' last answers were right, or it is "tested out" when the first 8 items she meets are all right first time. Each session is about 3/4 current level (missed items first, then new ones, with a sneak peek of the next level near the end) and 1/4 spaced review of earlier levels. Once every level is mastered, every round is spaced review, so she never runs out. | See the **Phonics ladder** section below for the round types. `startPhonics(id, { rounds, types })`: pass the round types your screen can draw. **The default is the B2 types only** (`find-letter`, `first-sound`, `build`), so the current screen keeps working and simply skips the rhyming and phrase levels. Add `'choose'` and `'build-phrase'` to unlock them. |
| 7 | `startPhonics` returns `game.ladder` (`{levels, current, currentIndex, allMastered}`), `game.level` (1-based number) and `game.levelName`. `summary.ladder` is `{current, before, levelUp, newlyMasteredLevels, levels}`. New `phonicsLadder(profileId, {types})` in `engine/runner.js` for a level map. | Celebrate `summary.ladder.levelUp` (G1). Show `round.levelTitle` and `round.levelEmoji` on the prompt card. |

### Phonics ladder: round types (A1)

Every round has `key`, `itemId`, `type`, `mode`, `level` (1-based number), `levelId`, `levelTitle`, `levelEmoji` and `say` (the sentence to speak for the prompt; speak it with `speech.say(round.say)` inside the tap). Answer with `game.answer(value)`; the result is the same as before: `{correct, partial, tries, reveal, answer, reward}`.

| type | mode(s) | fields | answer with |
|---|---|---|---|
| `find-letter` | `name` (letter names), `sound` (letter sounds) | `letter` (lowercase), `choices` (strings, already in display case), `display`, `case: 'upper'\|'lower'` (name mode), `sayAs` (sound mode: `speech.sayPhonics(letter)`) | the tapped choice (case ignored) |
| `first-sound` | `picture` | `letter`, `picture`, `emoji`, `choices` | the tapped letter |
| `build` | `cvc`, `digraphs`, `blends`, `sight` | `word`, `tiles` (letters plus 2 decoys), `emoji` (may be null), `chunks` (digraphs: e.g. `['sh','i','p']`, for optional chunk tiles), `digraph`, `showWord` (**true until she has built it right once; then hide the word and let her build from the sound and picture**) | the letters built so far (partial until full length) |
| `choose` *(new)* | `rhyme`, `sight` | `title`, `prompt`, `target: {label, emoji, say}` (rhyme: the word to rhyme with; sight: `label` is null, so play `say` only), `choices: [{id, value, label, word, emoji, say}]`, `answer` (a choice id) | the choice's `value` (= `id`) |
| `build-phrase` *(new)* | `phrase` | `phrase` (e.g. `"big dog"`), `word` (same), `words: ['big','dog']`, `tiles` (letters only, plus 3 decoys), `emoji`, `showWord` | the letters built so far; spaces and case are ignored, so show a gap between words in the slots |

Sight words are recognised first (a `choose` round) and spelled with `build` once she knows them, if your screen opted in to `choose`. Without `choose` they are always `build`.

### Clip manifest (bee-eng's V1 output)

`app/audio/<listId>/manifest.json`, where `<listId>` is the word list's `id` (e.g. `district-2026-r2`):

```json
{ "schema": "spellingbee.audio/1", "listId": "district-2026-r2", "ext": "m4a", "voice": "…",
  "clips": { "w0001": ["word", "definition", "sentence", "origin"], "w0002": ["word", "sentence"] } }
```

A clip is `app/audio/<listId>/<wordId>/<kind>.<ext>`. An entry may instead map kinds to paths inside the list folder (`{"word": "w0001/word.m4a"}`). Absolute and `../` paths are ignored, and only list clips that exist. **Record exactly `spokenText(word, kind)` from `engine/clues.js`** (word = `audio.sayAs` or the word; definition = `"Definition: …"`; sentence as written; origin = `"Language of origin: …."`), so the clip and the device-voice fallback say the same thing. Use AAC `.m4a` (Safari-friendly), mono, about 64 kbps.

## Changed in B1a (wire these in the screens)

These are fixes for review R1. Each section further down has the details.

| # | Change | What screens should do | R1 |
|---|---|---|---|
| 1 | `session.finish()` is **idempotent**: every call returns the same promise. | You can drop any double-finish workaround, but still disable or remove the Finish button synchronously so the screen doesn't render twice. | H1 |
| 2 | New `session.abandon()` closes a round the child left. With ≥1 counted answer the round is closed like `finish()` (session rewards and streak day by the normal rules, `summary.abandoned: true`); with no answers it resolves `null`. After `finish()` it returns the finish promise. | Call `session.abandon()` (no await) in every play screen's cleanup: Map, back, or route change. Phonics too. | M1 |
| 3 | `session.submit(letters, { assisted: true })` and `session.peek()` | Call `session.peek()` when Peek is tapped, or pass `{assisted:true}`. A peeked word never counts: no SRS move, no mastery token, retry-sized XP, and it's left out of session accuracy, so peeking every word earns no session tokens. `result.assisted` is `true`. | M2 |
| 4 | Better `maskWord(text, word)` in `engine/text.js`: inflections, dropped e, y→i, doubled consonant, hyphen/space/apostrophe variants. | Replace `maskWordInText` in `ui/components.js` with `maskWord`. | M4 |
| 5 | `topMistakes()` items now include `patterns: string[]`, most frequent first. | `mistakes.js` already reads `item.patterns`. | L6 |
| 6 | The manifest `name` and `short_name` are now **SpellQuest**. | None (matches `index.html`). | L8 |
| 7 | New `prepareBackup()`. `shareBackup(prepared)` calls `navigator.share` synchronously. | Call `prepareBackup()` when the Backup panel renders and keep the result. In the button's tap, call `shareBackup(prepared)` with **no await before it**. | parent.js:810 |
| 8 | **Parent session.** Typing the PIN on the pad (`verifyPin`) opens a 2-minute parent session, extended by each successful parent action. It locks after 2 idle minutes or as soon as the app is hidden. `markAdded`, `declineCard`, `adjustTokens` and `setRewardSettings` now need an open session **and** the PIN, otherwise they return `{ok:false, reason:'parent-locked'}` (`setRewardSettings` throws `code:'parent-locked'`). New events `parent:unlocked` and `parent:locked`, plus `lockParent()` and `parentSessionActive()`. | Listen for `parent:locked` and show the PIN gate again. Call `lockParent()` from "Lock & Exit" and the screen cleanup. Treat `parent-locked` as "enter your PIN again". | M6 |
| 9 | `wallet.rewardName` and `wallet.minutesPerToken` are now documented. `Summary` also has `rewardName`, `minutesPerToken` and `abandoned`. | Use these instead of the hardcoded "PS5". | L7 |
| 10 | `submit`, `skip` and `answer` return `null` once the round is finished or abandoned. | Ignore taps that return `null`. | H1 |

The app `VERSION` is bumped to 0.1.1 in `sw.js` and `main.js`.

This is the contract between the core modules (owned by bee-arch) and the screens (owned by bee-ui).
Every path is relative to `app/js/`. There are no dependencies and no build step, and the app makes no network requests except for its own same-origin files.

**Pure** modules don't touch the DOM, IndexedDB or `fetch`. They take `now` (epoch ms) as an input and are tested with `node --test`.

## Rules for screens

1. **Speech must start inside the tap.** Call `speech.*` synchronously from the `pointerup`/`click` handler. Don't `await` anything before the call, and don't call it from a `setTimeout`. Every word record the screen needs is already in memory, and `session.submit()` returns synchronously for this reason.
2. Use relative URLs only (`./`, never `/`). The site is served from a GitHub Pages sub-path.
3. Don't use `<input>` for spelling. The UI keyboard calls `session.submit(letters)`.
4. Don't hardcode word fields. Get clue text only from `clueText(word, kind)` (`engine/clues.js`) and hide a clue button when `hasSafeClue(word, kind)` is false.

## Boot and wiring (`main.js`, `router.js`)

`index.html` must contain `<main id="app"></main>` and `<script type="module" src="js/main.js"></script>`.

`main.js` boots the app: it opens the DB, calls `navigator.storage.persist()`, registers `sw.js`, loads the word lists and then runs
`import('./screens/index.js')` → `registerScreens(ctx)` (**bee-ui owns `screens/index.js`**), and then `router.start()`.

```js
// screens/index.js (bee-ui)
export function registerScreens({ router, app }) {
  router.on('#/kids', KidPicker);           // default route
  router.on('#/home/:profileId', Home);
  router.on('#/play/:profileId/:kind', Play); // kind: practice|stage|review|phonics
  router.on('#/parent', Parent);
}
// Screen = { mount(rootEl, params, query) -> optional cleanup() }
```

`router`: `on(pattern, screen)`, `go(hash, {replace})`, `back()`, `current()` → `{hash, params, query}`, `start(defaultHash='#/kids')`.

`app` (exported from `main.js` as well): `{ ready: Promise, version, events, setTheme(themeId) }`.
`main.js` sets `<html data-theme>` from the active profile. Theme ids: `pinehook | ridgecrest | starquill | skydrop`.

## Events (`store/events.js`)

`events.on(name, fn)` → `off()`, `events.emit(name, detail)`.

| Event | Detail |
|---|---|
| `profile:active` | `{ profile }` |
| `profiles:changed` | `{}` |
| `wallet:changed` | `{ profileId, wallet }` |
| `wordlists:changed` | `{ lists }` |
| `speech:state` | `{ state: 'speaking'\|'idle'\|'stalled'\|'novoice', text }` |
| `sw:updated` | `{}`: a new version is cached; it takes effect on the next launch |
| `storage:error` | `{ error }` (for example a quota error) |
| `parent:unlocked` | `{ until }`: the parent session opened (PIN typed on the pad) |
| `parent:locked` | `{ reason: 'idle'\|'hidden'\|'manual' }`: show the PIN gate again |

## Profiles (`store/profiles.js`)

```js
listProfiles() -> Promise<Profile[]>
getProfile(id) -> Promise<Profile|null>
createProfile({ name, mode, avatar, theme }) -> Promise<Profile> // applies the mode defaults below
updateProfile(id, patch) -> Promise<Profile>   // shallow merge; settings merged one level
deleteProfile(id, pin) -> Promise<void>        // needs the parent PIN
setActiveProfile(id) / getActiveProfileId()    // localStorage; emits profile:active
```

```js
Profile = {
  id, name, avatar, theme,
  mode: 'competition' | 'practice' | 'phonics',
  wordListIds: string[],          // [] = all lists
  xp, coins, owned: string[], equipped: { [slot]: itemId },
  streak: { count, lastDay },     // lastDay 'YYYY-MM-DD'
  settings: {
    sessionSize,                  // 12 | 8 | 5 by mode
    timerSec,                     // competition 60; others null (no timer)
    beeRules: false,              // true = no backspace (opt-in; T2 says editing is allowed by default)
    showLength,                   // practice true; competition false (growing strip)
    keyboard: 'qwerty'|'abc'|'guided',
    clues: string[],              // which clue buttons show, see hasClue
    rate: 0.85,                   // speech rate for the word
    beeDate: null,                // overrides the list's beeDate for SRS compression
  },
  createdAt, updatedAt
}
```

## Word lists (`store/wordlists.js`, pure normalizer in `engine/wordlist.js`)

The built-in lists are listed in `app/data/wordlists/index.json` → `{"lists":["round2.json"]}`. If that file is missing, the loader tries `round2.json`.
The parent can also import a list from a JSON file, which is stored in IndexedDB.

```js
loadWordLists() -> Promise<WordList[]>       // fetch built-ins and merge with imported lists; emits wordlists:changed
getWordLists() -> WordList[]                 // sync, after load
wordsForProfile(profile) -> Word[]           // sync; deduped by key
importWordListFile(file) -> Promise<WordList>
removeImportedList(id) -> Promise<void>
```

The schema is `spellingbee.wordlist/1` (T1 §2). The normalizer also accepts the OCR draft array `[{word, source_image, confidence}]` and a `definition` string.

```js
Word = { key, id, listId, word, accept[], grade, difficulty, partOfSpeech,
         definitions[], sentence, origin, audio:{sayAs, respell, ipa, file}, altPronunciation,
         homophones[], tags[], syllables, reviewed }
// key = word lowercased and trimmed; progress is stored by key, so it follows a word across lists.
hasClue(word, kind) -> boolean   // kind: definition|sentence|partOfSpeech|origin|altPronunciation|syllables
```

## Learning session (`engine/session.js` is pure, `engine/runner.js` persists)

```js
import { startSession } from './engine/runner.js';
const s = await startSession(profileId, { kind: 'practice' | 'stage' | 'review', size });
s.words            // Word[] queue (already chosen)
s.index, s.total
s.current()        // Word | null when done
s.submit(letters, { assisted })  // SYNC -> Result (null after finish/abandon); saving runs in the background (s.saved)
s.peek()           // mark the current word as assisted (Peek); same effect as submit(..., {assisted:true})
s.canRetry()       // practice: one retry after a miss; stage: false
s.skip()           // counts as "not yet", no penalty text (null after finish/abandon)
s.next()           // -> Word | null
await s.finish()   // -> Summary; awards session rewards. Idempotent: same promise every call
s.abandon()        // child left mid-round: closes like finish() if >=1 counted answer, else resolves null
s.finished         // true once finish() or abandon() has been called
s.timer            // stage only: { limitSec, start(onTick, onTimeUp), stop(), remaining() }
```

```js
Result = {
  correct, counted,            // counted=false for retries and assisted words (no SRS change)
  assisted,                    // true when the child peeked at this word
  target,                      // official spelling (keeps any hyphen)
  attemptMarks: [{ch, ok}],    // "You spelled" row
  targetMarks:  [{ch, ok}],    // "Correct spelling" row
  firstWrongIndex,             // -1 if correct
  lettersRightFromStart,       // "you had the first 6 letters right"
  patterns: string[],          // 'double-letter'|'silent-letter'|'swap'|'ie-ei'|'ending'|'vowel'
  reward: { xp, coins, tokens, tokenCapped }, // tokens are usually 0 per word (see economy)
  fixit: { added, cleared },
  progress                     // updated SRS record
}
Summary = { kind, answered, correct, accuracy, xp, coins, tokens, tokenCapped,
            minutesEarned, rewardName, minutesPerToken, abandoned,
            newlyMastered: string[], fixitLeft, streak }
// answered/correct count only counted answers (no retries, no assisted words)
```

Helpers: `fixitCount(profileId)`, `readiness(profileId)` → `{ total, mastered, seen, fixit, pct }`, `topMistakes(profileId, n)` →
`[{ word, key, wrong, correct, fixit, lastAttempts: string[], patterns: string[] }]`. Patterns come from `grade()` over the recent misses, most frequent first:
`'double-letter'|'silent-letter'|'swap'|'ie-ei'|'ending'|'vowel'`.

## Clue text (`engine/text.js`, pure)

```js
maskWord(text, word, blank = '______') -> string
// whole-word, case-insensitive; hides the word and inflected forms:
// accommodate -> accommodated/accommodating/accommodation, happy -> happily/happiness,
// stop -> stopped/stopping, passer-by -> passer by/passerby
wordStems(word) -> string[]   // the stems used above
```

Stage mode never shows the word before the attempt. The timer only signals `onTimeUp`. The screen chooses what to do (T2: running out of time doesn't erase the attempt).

## Phonics (`engine/phonics.js` pure, `engine/runner.js`)

```js
const p = await startPhonics(profileId, { rounds: 5 });
p.current() -> Round
//   { type: 'find-letter', letter, choices: ['b','d','p'], sayAs }   // tap the letter you hear
//   { type: 'first-sound', picture: 'fish', letter: 'f', choices }
//   { type: 'build', word: 'cat', tiles: ['c','a','t','m','s'] }    // CVC word
p.answer(choiceOrLetters) -> { correct, tries, reveal }  // SYNC; reveal=true after 2 misses; null after finish/abandon
p.next() / await p.finish() -> Summary   // finish() idempotent
p.abandon()                              // same contract as the spelling session
```

## Speech (`audio/speech.js`), following T2 §1

```js
speech.sayWord(word, { slow })         // speaks word.audio.sayAs || word.word (word rate 0.85)
speech.sayClue(word, kind)             // 'definition' | 'sentence' | 'partOfSpeech' | 'origin' | 'altPronunciation' | 'all'
speech.sayLetters(str)                 // letter by letter, for "here's how it's spelled"
speech.sayLetter(ch)                   // one key press (speaks the letter name)
speech.sayPhonics(letter)              // recorded audio/phonics/<l>.m4a if present, else TTS "b, as in ball"
speech.say(text, { rate })             // anything else (praise, prompts)
speech.stop()
speech.replay()                        // repeats the last utterance; this is the "Tap to hear it again" button
speech.state()                         // 'speaking'|'idle'|'stalled'|'novoice'
speech.voices() -> [{ name, lang, local }]  // filtered en-* list for the parent picker
speech.setVoice(name|null) / speech.currentVoice()
```

`stalled` means the voice didn't start or stopped responding (after an app switch or lock, or an iPadOS 27 cancel bug). The screen should then show a large **Tap to hear it again** button wired to `speech.replay()`. If `novoice` fires, keep the clue text on screen.

## Rewards (`rewards/economy.js` pure, `rewards/wallet.js` persists)

There are three separate currencies:
- **XP** sets the level. It's never spent.
- **Coins** buy cosmetics only.
- **Reward tokens** become PS5 minutes (`minutesPerToken`, default 5). The parent grants the minutes by hand.

```js
getWallet(profileId) -> Promise<Wallet>
// Wallet = { xp, level, levelProgress, nextLevelAt, coins, tokens, minutes,
//            rewardName /* e.g. 'PS5' */, minutesPerToken, pending: Card[],
//            earnedToday, dailyCap, owned, equipped }
requestCashIn(profileId, tokens) -> Promise<Card>   // the kid taps "Cash in"; creates a pending card
cancelRequest(cardId) -> Promise<void>              // the kid can undo their own pending card
listPending() -> Promise<Card[]>                    // all kids; for the parent screen
markAdded(cardId, pin) -> Promise<{ok, reason}>     // parent "I added it"; open parent session + PIN
declineCard(cardId, pin) -> Promise<{ok, reason}>   // tokens go back to the kid; session + PIN
adjustTokens(profileId, tokens, note, pin) -> Promise<{ok, reason}> // integer, non-zero; session + PIN
// reason 'parent-locked' = the session expired or the app was hidden: show the PIN pad again
buyItem(profileId, item) -> Promise<{ok, reason}>   // item = { id, cost, slot }; coins only
equipItem(profileId, slot, itemId)
getRewardSettings() / setRewardSettings(patch, pin)   // set: session + PIN, throws err.code on failure
// Card = { id, profileId, tokens, minutes, status:'pending'|'added'|'declined', requestedAt, resolvedAt }
```

PS5 instructions for the card (T2 §5): `ps5Steps(card, profileName)` → string[] (from `economy.js`).

## Parent PIN (`parent/pin.js`)

```js
hasPin() -> Promise<boolean>
setPin(newPin, currentPin?) -> Promise<{ok, reason}>   // 4–6 digits; currentPin needed if one exists
verifyPin(pin) -> Promise<{ ok, triesLeft, lockedUntil }> // locks for 5 min after 5 wrong tries;
                                                         // success opens the parent session
parentSessionActive() -> boolean
lockParent(reason?)        // "Lock & Exit" and Parent screen cleanup; emits parent:locked
PARENT_SESSION_MS          // 120000; idle time before the session locks itself
```

Real-world reward actions (`markAdded`, `declineCard`, `adjustTokens`, `setRewardSettings`) need an open parent session **and** the PIN. A PIN cached by a screen stops working once the parent has been away for 2 minutes or the app was hidden, so a child can't approve their own minutes on a Parent screen left open. Profile deletion and backup import still need only the PIN.

The PIN is stored as a salted PBKDF2-SHA256 hash. It stops casual access only, and the parent screen should say so.

## Backup (`store/backup.js`)

```js
exportBackup() -> Promise<{ blob, filename, data }>  // everything except the PIN hash
prepareBackup() -> Promise<Prepared>                 // call when the Backup panel renders
shareBackup(prepared) -> Promise<'shared'|'downloaded'|'cancelled'>
  // call inside the tap with NO await before it; navigator.share runs synchronously.
  // Without `prepared` it reads the DB first, and iPadOS may then refuse the share sheet.
importBackup(file, { mode: 'merge' | 'replace' }, pin) -> Promise<{ ok, counts, reason }>
lastBackupAt() -> Promise<number|null>
```
