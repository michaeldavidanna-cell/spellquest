/**
 * Screen 4b: Phonics Mini-Mode (5-Year-Old Explorer — Libby)
 * Wired to A1's full 9-level phonics ladder:
 *   types: ['find-letter', 'first-sound', 'build', 'choose', 'build-phrase']
 * Displays round.levelTitle + round.levelEmoji, uses round.say, respects showWord,
 * draws a visual level map, and celebrates summary.ladder.levelUp with playLevelUpBurst.
 */

import { getProfile } from '../store/profiles.js';
import { getRewardSettings, getWallet } from '../rewards/wallet.js';
import { startPhonics } from '../engine/runner.js';
import { speech } from '../audio/speech.js';
import {
  el,
  renderLetterSlots,
  renderPlayHud,
  showToast,
  speakerSvg,
} from '../ui/components.js';
import {
  playLevelUpBurst,
  playThemeCelebration,
  renderTrophySummaryCard,
} from '../ui/celebrations.js';
import { applyTheme, getAvatarEmoji, getTheme, pickRandom } from '../ui/themes.js';

const SUPPORTED_PHONICS_TYPES = ['find-letter', 'first-sound', 'build', 'choose', 'build-phrase'];

const PICTURE_EMOJI = {
  ant: '🐜', apple: '🍎', ball: '⚽', bat: '🦇', bear: '🐻', bed: '🛏️', bee: '🐝',
  bell: '🔔', bike: '🚲', bird: '🐦', boat: '⛵', book: '📖', box: '📦', bug: '🐛',
  bus: '🚌', cake: '🎂', cap: '🧢', car: '🚗', cat: '🐱', chair: '🪑', cheese: '🧀',
  chick: '🐥', chip: '🍟', clock: '⏰', cloud: '☁️', cow: '🐮', crab: '🦀', crown: '👑',
  cup: '☕', dog: '🐶', drum: '🥁', duck: '🦆', egg: '🥚', fan: '🪭', fin: '🦈',
  fish: '🐟', flag: '🚩', flower: '🌸', fox: '🦊', frog: '🐸', gift: '🎁', goat: '🐐',
  grapes: '🍇', hand: '✋', hat: '🎩', hen: '🐔', hill: '⛰️', hop: '🐇', house: '🏠',
  insect: '🐞', jam: '🍓', jet: '✈️', jump: '🦘', key: '🔑', king: '🤴', kite: '🪁',
  lamp: '💡', leaf: '🍃', lion: '🦁', lock: '🔒', log: '🪵', map: '🗺️', milk: '🥛',
  moon: '🌙', mop: '🧹', mud: '🟤', mug: '☕', nest: '🪺', net: '🥅', octopus: '🐙',
  owl: '🦉', pan: '🍳', pen: '🖊️', pig: '🐷', pin: '📌', plane: '✈️', plant: '🪴',
  pond: '🏞️', pot: '🍲', queen: '👑', rabbit: '🐰', rain: '🌧️', rat: '🐭', red: '🔴',
  ring: '💍', rock: '🪨', rod: '🎣', rug: '🧶', sand: '🏖️', sheep: '🐑', shell: '🐚',
  ship: '🚢', shoe: '👟', shop: '🏪', sit: '🪑', sled: '🛷', snail: '🐌', snake: '🐍',
  snow: '❄️', sock: '🧦', spoon: '🥄', star: '⭐', stop: '🛑', sun: '☀️', swim: '🏊',
  tent: '⛺', thumb: '👍', top: '🪀', train: '🚂', tree: '🌲', truck: '🚚', tub: '🛁',
  umbrella: '☂️', van: '🚐', web: '🕸️', whale: '🐋', wheel: '🛞', wig: '🦱', wing: '🪽',
  worm: '🪱', yak: '🐃', 'yo-yo': '🪀', zebra: '🦓', zip: '🤐',
};

function emojiFor(word) {
  const key = String(word || '').toLowerCase().trim();
  return PICTURE_EMOJI[key] || '🌟';
}

function levelBadgeText(round, game) {
  const title = round?.levelTitle || round?.level?.title || game?.levelName;
  const emoji = round?.levelEmoji || round?.level?.emoji || '';
  const num = typeof round?.level === 'number' ? round.level : game?.level;
  if (title) {
    return `${emoji ? `${emoji} ` : ''}${num ? `Lv ${num} • ` : ''}${title}`;
  }
  return 'Phonics Explorer';
}

/** Compact visual ladder map showing all 9 phonics levels & mastery progress. */
function renderLadderMap(ladder) {
  if (!ladder?.levels?.length) return null;
  const strip = el('div', {
    class: 'phonics-level-bar',
    style: 'width:100%;max-width:680px;margin-top:4px;',
    'aria-label': 'Phonics level map',
  });
  for (const lv of ladder.levels) {
    const isCur = lv.id === ladder.current;
    const cls = lv.mastered ? 'pill pill--success' : isCur ? 'pill pill--gold' : 'pill';
    const mark = lv.mastered ? '✓ ' : isCur ? '▶ ' : '';
    strip.append(
      el(
        'span',
        { class: cls, style: 'font-size:13px;padding:5px 10px;' },
        `${mark}${lv.emoji ? `${lv.emoji} ` : ''}${lv.title}`
      )
    );
  }
  return strip;
}

/** Renders grouped slots with a clear word gap for `build-phrase` (e.g., "big dog"). */
function renderPhraseSlots(words, builtLetters) {
  const chars = Array.from(builtLetters.toUpperCase());
  const wrap = el('div', {
    class: 'letter-slots',
    style: 'flex-wrap:wrap;gap:16px;',
    role: 'region',
    'aria-live': 'polite',
  });
  let cursor = 0;
  for (const w of words) {
    const cleanLen = String(w).replace(/[^a-z]/gi, '').length;
    const group = el('div', { style: 'display:flex;gap:5px;' });
    for (let i = 0; i < cleanLen; i++) {
      const ch = chars[cursor];
      const isCursor = cursor === chars.length;
      if (ch) group.append(el('span', { class: 'slot filled' }, ch));
      else if (isCursor) group.append(el('span', { class: 'slot active' }, el('span', { class: 'slot-cursor' })));
      else group.append(el('span', { class: 'slot' }));
      cursor++;
    }
    wrap.append(group);
  }
  return wrap;
}

export function PhonicsScreen({ router, app }) {
  return {
    mount(rootEl, params) {
      let alive = true;
      const profileId = params?.profileId;
      const section = el('section', { class: 'screen screen--play is-active', dataset: { screen: 'phonics' } });
      rootEl.innerHTML = '';
      rootEl.append(section);

      let gameRef = null;
      let answeredAny = false;
      let finished = false;
      let finishing = false;

      const cleanup = () => {
        alive = false;
        if (gameRef && answeredAny && !finished && !finishing) {
          finishing = true;
          if (typeof gameRef.abandon === 'function') gameRef.abandon();
          else gameRef.finish().catch(() => {});
        }
        speech.stop();
      };

      const boot = async () => {
        const [profile, rewardSettings, initialWallet] = await Promise.all([
          getProfile(profileId),
          getRewardSettings().catch(() => ({ rewardName: 'PS5', minutesPerToken: 5 })),
          getWallet(profileId).catch(() => ({ level: 1 })),
        ]);
        if (!alive) return;
        if (!profile) {
          router.go('#/kids', { replace: true });
          return;
        }
        const startLevel = initialWallet?.level || 1;
        const rewardName = rewardSettings?.rewardName || 'PS5';
        const theme = app?.setTheme ? (app.setTheme(profile.theme), getTheme(profile.theme)) : applyTheme(profile.theme);

        // Pass all 5 A1 phonics round types to unlock rhyming, sight words & two-word phrases
        const game = await startPhonics(profile.id, {
          rounds: profile.settings?.sessionSize || 5,
          types: SUPPORTED_PHONICS_TYPES,
        });
        if (!alive) return;
        gameRef = game;

        let idx = 0;
        const total = game.total || profile.settings?.sessionSize || 5;
        let roundState = 'playing'; // 'playing' | 'cheering'
        let revealHint = false;
        let builtLetters = '';
        let outcomes = [];
        let streakInRound = 0;
        let bestStreak = 0;

        const shell = el('div', { class: 'play-shell' });
        const hudMount = el('div');
        const bodyMount = el('div', { class: 'phonics-stage' });
        shell.append(hudMount, bodyMount);
        section.innerHTML = '';
        section.append(shell);

        const speakPrompt = (round) => {
          if (!round) return;
          if (round.type === 'find-letter' && round.mode === 'sound') {
            speech.sayPhonics(round.letter);
            return;
          }
          if (round.say) {
            speech.say(round.say, { rate: 0.88 });
            return;
          }
          if (round.type === 'find-letter') {
            speech.sayPhonics(round.letter);
          } else if (round.type === 'first-sound') {
            speech.say(`${round.picture}. What letter starts ${round.picture}?`, { rate: 0.9 });
          } else if (round.type === 'build') {
            speech.say(`Let's build ${round.word}!`, { rate: 0.85 });
          } else if (round.type === 'build-phrase') {
            speech.say(`Let's spell ${round.phrase}!`, { rate: 0.85 });
          }
        };

        const leaveToMap = async (btn) => {
          if (finishing) return;
          if (btn) btn.disabled = true;
          if (answeredAny && !finished) {
            finishing = true;
            try {
              if (typeof game.abandon === 'function') await game.abandon();
              else await game.finish();
              finished = true;
              showToast('Stars saved!', { tone: 'gold' });
            } catch {
              // ignore save error on exit
            }
          }
          router.go(`#/home/${encodeURIComponent(profile.id)}`);
        };

        const finishGame = async () => {
          if (finishing || finished) return;
          finishing = true;
          const summary = await game.finish();
          finished = true;
          const afterWallet = await getWallet(profile.id).catch(() => ({ level: startLevel }));
          if (!alive) return;

          const xpLevelUp = (afterWallet?.level || startLevel) > startLevel;
          const ladderLevelUp = Boolean(summary?.ladder?.levelUp);
          const leveledUp = xpLevelUp || ladderLevelUp;

          const nextLadderLevel = ladderLevelUp
            ? summary.ladder.levels?.find((l) => l.id === summary.ladder.current)
            : null;
          const levelTitle = nextLadderLevel
            ? `${nextLadderLevel.emoji ? `${nextLadderLevel.emoji} ` : ''}${nextLadderLevel.title}`
            : '';

          if (leveledUp) {
            playLevelUpBurst({
              level: afterWallet?.level || startLevel,
              title: levelTitle,
              themeId: theme.id,
            });
          } else {
            playThemeCelebration({
              themeId: theme.id,
              streak: Math.max(bestStreak, summary.correct >= 3 ? 3 : 1),
              fxStyle: profile.equipped?.fx || 'fx-rainbow-confetti',
            });
          }

          section.className = 'screen screen--scroll is-active';
          section.innerHTML = '';

          const wrap = el('div', { class: 'page-wrap' });
          wrap.append(
            renderTrophySummaryCard({
              themeId: theme.id,
              title: `Way to go, ${profile.name}!`,
              subtitle: `${summary.correct ?? 0} of ${summary.answered ?? total} adventures completed!`,
              summary,
              rewardName,
              bestStreak,
              leveledUp,
              newLevel: levelTitle || (xpLevelUp ? afterWallet.level : null),
              actions: [
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/phonics`),
                  },
                  '🎈 Play Again!'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--lg',
                    onClick: () => router.go(`#/home/${encodeURIComponent(profile.id)}`),
                  },
                  '◀ Back to Map'
                ),
              ],
            })
          );

          if (summary?.ladder?.levels?.length) {
            wrap.append(
              el(
                'div',
                { class: 'card', style: 'display:flex;flex-direction:column;align-items:center;gap:10px;' },
                el('h3', { class: 'h3' }, 'Reading Adventure Ladder'),
                renderLadderMap(summary.ladder)
              )
            );
          }

          section.append(wrap);
        };

        const goNext = () => {
          if (finishing || finished) return;
          const nextRound = game.next();
          if (!nextRound) {
            finishGame();
            return;
          }
          idx += 1;
          roundState = 'playing';
          revealHint = false;
          builtLetters = '';
          speakPrompt(nextRound);
          render();
        };

        const renderStartGate = () => {
          const firstRound = game.current();
          const badge = levelBadgeText(firstRound, game);
          const heroEmoji = firstRound?.levelEmoji || '🎈';
          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: badge,
              currentIndex: 0,
              total,
              results: [],
            })
          );

          bodyMount.innerHTML = '';
          bodyMount.append(
            el(
              'div',
              { class: 'card start-card', style: 'max-width:680px;' },
              el('span', { class: 'pill pill--gold' }, badge),
              el('div', { style: 'font-size:78px;line-height:1;' }, heroEmoji),
              el('h1', { class: 'h1' }, `Ready, ${profile.name}?`),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary btn--lg btn--block',
                  style: 'min-height:84px;font-size:26px;',
                  onClick: () => {
                    speakPrompt(firstRound);
                    render();
                  },
                },
                '▶ Tap to Play!'
              ),
              renderLadderMap(game.ladder)
            )
          );
        };

        const render = () => {
          const round = game.current();
          if (!round) {
            finishGame();
            return;
          }

          const badge = levelBadgeText(round, game);

          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: badge,
              currentIndex: idx,
              total,
              results: outcomes,
              rightExtra: streakInRound >= 2 ? el('span', { class: 'pill pill--gold' }, `🔥 ${streakInRound}`) : null,
            })
          );

          bodyMount.innerHTML = '';

          // Prompt card with levelTitle + levelEmoji
          const promptCard = el('div', { class: 'card phonics-prompt-card' });
          promptCard.append(el('div', { class: 'phonics-level-bar' }, el('span', { class: 'pill pill--gold' }, badge)));

          // Big friendly picture visual (sight recognition has target.emoji=null -> speaker icon!)
          const picEmoji =
            (round.type === 'choose' && round.mode === 'sight')
              ? '🔊'
              : (round.emoji ||
                 round.target?.emoji ||
                 (round.picture ? emojiFor(round.picture) : null) ||
                 (round.type === 'build' && round.mode !== 'sight' ? emojiFor(round.word) : null) ||
                 (round.type === 'build-phrase' ? '✨' : '🔊'));
          promptCard.append(el('div', { class: 'phonics-picture', 'aria-hidden': 'true' }, picEmoji));

          // Always prefer round.title (safe for sight words; never leaks sight word from round.prompt!)
          let titleText = 'Tap your answer!';
          if (round.title) titleText = round.title;
          else if (round.type === 'choose' && round.mode === 'sight') titleText = 'Tap the word you hear!';
          else if (round.prompt) titleText = round.prompt;
          else if (round.type === 'find-letter' && round.mode === 'name') {
            titleText = round.case === 'upper' ? 'Tap the CAPITAL letter you hear!' : 'Tap the small letter you hear!';
          } else if (round.type === 'find-letter') titleText = 'Tap the letter you hear!';
          else if (round.type === 'first-sound') titleText = `What letter starts "${round.picture}"?`;
          else if (round.type === 'build') titleText = round.showWord ? 'Copy & build the word!' : 'Build the word you hear!';
          else if (round.type === 'build-phrase') titleText = round.showWord ? 'Build the two-word phrase!' : 'Spell the phrase you hear!';

          promptCard.append(el('h1', { class: 'h2' }, titleText));

          // Target word pill for rhyming, or copy-along model when showWord=true
          if (round.type === 'choose' && round.target?.label) {
            promptCard.append(el('div', { class: 'phonics-rhyme-pill' }, String(round.target.label).toUpperCase()));
          } else if ((round.type === 'build' || round.type === 'build-phrase') && round.showWord) {
            const modelText = round.chunks?.length
              ? round.chunks.join(' · ')
              : (round.phrase || round.word || '');
            promptCard.append(el('div', { class: 'phonics-rhyme-pill' }, String(modelText).toUpperCase()));
          }

          promptCard.append(
            el(
              'button',
              {
                type: 'button',
                class: 'speak-hero',
                style: 'max-width:340px;',
                onClick: () => speakPrompt(round),
              },
              el('span', { class: 'speaker-ring', html: speakerSvg(28) }),
              el('span', { class: 'speak-hero__text' }, el('strong', {}, 'Hear Sound'), el('small', {}, 'Tap to play again'))
            )
          );

          bodyMount.append(promptCard);

          if (roundState === 'cheering') {
            const cheerWord =
              round.type === 'choose'
                ? round.choices?.find((c) => (c.value ?? c.id) === round.answer)?.label
                : (round.phrase || round.word || round.display || round.letter);
            bodyMount.append(
              el(
                'div',
                { class: 'card', style: 'width:100%;max-width:620px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;' },
                el('h2', { class: 'h2' }, `🌟 ${pickRandom(theme.praise)}`),
                cheerWord ? el('div', { style: 'font-size:38px;font-weight:900;letter-spacing:0.1em;' }, String(cheerWord)) : null,
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    disabled: finishing,
                    onClick: (e) => {
                      e.currentTarget.disabled = true;
                      goNext();
                    },
                  },
                  idx + 1 >= total ? 'See My Prize! 🎉' : 'Next Adventure →'
                )
              )
            );
            return;
          }

          // 1) `choose` rounds (Rhyming + Sight-word recognition)
          if (round.type === 'choose') {
            const choicesEl = el('div', { class: 'phonics-choices' });
            for (const c of round.choices || []) {
              const val = c.value ?? c.id;
              const isTarget = String(val) === String(round.answer);
              const btn = el(
                'button',
                {
                  type: 'button',
                  class: `phonics-word-choice${revealHint && isTarget ? ' is-hint' : ''}`,
                  onClick: () => {
                    const res = game.answer(val);
                    if (!res) return;
                    answeredAny = true;
                    if (res.correct) {
                      outcomes[idx] = true;
                      streakInRound += 1;
                      bestStreak = Math.max(bestStreak, streakInRound);
                      roundState = 'cheering';
                      playThemeCelebration({
                        themeId: theme.id,
                        streak: streakInRound,
                        fxStyle: profile.equipped?.fx || 'fx-rainbow-confetti',
                        label: `${String(c.label).toUpperCase()}!`,
                      });
                      speech.say(`Yes! ${c.say || c.label}!`, { rate: 0.95 });
                      render();
                    } else {
                      streakInRound = 0;
                      btn.classList.add('is-wiggle');
                      window.setTimeout(() => btn.classList.remove('is-wiggle'), 360);
                      if (res.reveal) {
                        revealHint = true;
                        speakPrompt(round);
                        render();
                      } else {
                        speech.say(`That says ${c.say || c.label}. Try another one!`, { rate: 0.92 });
                      }
                    }
                  },
                },
                c.emoji ? el('span', { style: 'font-size:40px;line-height:1;' }, c.emoji) : null,
                el('span', {}, String(c.label))
              );
              choicesEl.append(btn);
            }
            bodyMount.append(choicesEl);
            return;
          }

          // 2) `find-letter` (upper/lower case preserved in name mode) & `first-sound`
          if (round.type === 'find-letter' || round.type === 'first-sound') {
            const preserveCase = round.type === 'find-letter' && round.mode === 'name';
            const choicesEl = el('div', { class: 'phonics-choices' });
            for (const ch of round.choices || []) {
              const isTarget = String(ch).toLowerCase() === String(round.letter).toLowerCase();
              const label = preserveCase ? String(ch) : String(ch).toUpperCase();
              const btn = el(
                'button',
                {
                  type: 'button',
                  class: `phonics-choice-btn${revealHint && isTarget ? ' is-hint' : ''}`,
                  onClick: () => {
                    const res = game.answer(ch);
                    if (!res) return;
                    answeredAny = true;
                    if (res.correct) {
                      outcomes[idx] = true;
                      streakInRound += 1;
                      bestStreak = Math.max(bestStreak, streakInRound);
                      roundState = 'cheering';
                      playThemeCelebration({
                        themeId: theme.id,
                        streak: streakInRound,
                        fxStyle: profile.equipped?.fx || 'fx-rainbow-confetti',
                        label: `Yes! ${label}!`,
                      });
                      speech.say(`Yes! ${String(ch).toUpperCase()}!`, { rate: 1.0 });
                      render();
                    } else {
                      streakInRound = 0;
                      btn.classList.add('is-wiggle');
                      window.setTimeout(() => btn.classList.remove('is-wiggle'), 360);
                      if (res.reveal) {
                        revealHint = true;
                        speakPrompt(round);
                        render();
                      } else {
                        speech.say(`That's ${String(ch).toUpperCase()}. Listen and try again!`, { rate: 0.95 });
                      }
                    }
                  },
                },
                label
              );
              choicesEl.append(btn);
            }
            bodyMount.append(choicesEl);
            return;
          }

          // 3) `build` (CVC, digraphs, blends, sight words) & `build-phrase` (two-word phrases)
          const isPhrase = round.type === 'build-phrase' && Array.isArray(round.words);
          const rawTarget = String(round.phrase || round.word || '');
          const cleanTarget = rawTarget.toLowerCase().replace(/[^a-z]/g, '');

          const slotsNode = isPhrase
            ? renderPhraseSlots(round.words, builtLetters)
            : renderLetterSlots({
                letters: builtLetters,
                targetLength: cleanTarget.length,
                showLength: true,
              });

          const slotsWrap = el(
            'div',
            { style: 'width:100%;max-width:680px;display:flex;flex-direction:column;align-items:center;gap:12px;' },
            slotsNode
          );

          const bank = el('div', { class: 'tile-bank' });
          const nextNeeded = cleanTarget[builtLetters.length];
          for (const ch of round.tiles || []) {
            const tileStr = String(ch).toLowerCase();
            const isHintTile = revealHint && tileStr === nextNeeded;
            bank.append(
              el(
                'button',
                {
                  type: 'button',
                  class: `bank-tile${isHintTile ? ' is-hint' : ''}`,
                  onClick: () => {
                    if (builtLetters.length >= cleanTarget.length) return;
                    builtLetters += tileStr;
                    speech.sayLetter(tileStr);

                    if (builtLetters.length === cleanTarget.length) {
                      const res = game.answer(builtLetters);
                      if (!res) return;
                      answeredAny = true;
                      if (res.correct) {
                        outcomes[idx] = true;
                        streakInRound += 1;
                        bestStreak = Math.max(bestStreak, streakInRound);
                        roundState = 'cheering';
                        playThemeCelebration({
                          themeId: theme.id,
                          streak: streakInRound,
                          fxStyle: profile.equipped?.fx || 'fx-rainbow-confetti',
                          label: `${rawTarget.toUpperCase()}!`,
                        });
                        speech.say(`${rawTarget}! Awesome!`, { rate: 0.95 });
                        render();
                        return;
                      }
                      streakInRound = 0;
                      builtLetters = '';
                      if (res.reveal) {
                        revealHint = true;
                      }
                      speech.say(`Almost! Listen closely: ${rawTarget}`, { rate: 0.85 });
                    }
                    render();
                  },
                },
                tileStr.toUpperCase()
              )
            );
          }

          const buildActions = el(
            'div',
            { style: 'display:flex;gap:12px;' },
            el(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost',
                disabled: !builtLetters.length,
                onClick: () => {
                  builtLetters = builtLetters.slice(0, -1);
                  render();
                },
              },
              '⌫ Undo Letter'
            )
          );

          slotsWrap.append(bank, buildActions);
          bodyMount.append(slotsWrap);
        };

        renderStartGate();
      };

      boot();
      return cleanup;
    },
  };
}
