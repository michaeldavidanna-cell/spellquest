# App core API (bee-arch)

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
4. Don't hardcode word fields. Hide a clue button when its field is empty (`hasClue(word, kind)`).

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
