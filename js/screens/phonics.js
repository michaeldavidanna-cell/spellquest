/**
 * Screen 4b: Phonics Mini-Mode (5-Year-Old Explorer)
 * Big touch targets, audio-first letter sounds & CVC picture word building,
 * zero punishing failure states, golden glow reveal after 2 tries.
 * Fixes: H1 (finish guard), H2 (big Tap to Play start screen), M1 (save on leave),
 * M3 (answer & speak on click), M5 (uses round.emoji from engine), L4 (real summary stats).
 */

import { getProfile } from '../store/profiles.js';
import { getRewardSettings } from '../rewards/wallet.js';
import { startPhonics } from '../engine/runner.js';
import { speech } from '../audio/speech.js';
import {
  celebrateBurst,
  el,
  renderLetterSlots,
  renderPlayHud,
  showToast,
  speakerSvg,
} from '../ui/components.js';
import { applyTheme, getAvatarEmoji, getTheme, pickRandom, renderThemeSceneSvg } from '../ui/themes.js';

const PICTURE_EMOJI = {
  ant: '🐜', apple: '🍎', ball: '⚽', bat: '🦇', bear: '🐻', bed: '🛏️', bee: '🐝',
  bike: '🚲', bird: '🐦', boat: '⛵', box: '📦', bug: '🐛', bus: '🚌', cake: '🎂',
  car: '🚗', cat: '🐱', cow: '🐮', cup: '☕', dog: '🐶', duck: '🦆', egg: '🥚',
  fish: '🐟', fox: '🦊', frog: '🐸', goat: '🐐', hat: '🎩', hen: '🐔', insect: '🐞',
  jam: '🍓', jet: '✈️', key: '🔑', kite: '🪁', leaf: '🍃', lion: '🦁', log: '🪵',
  map: '🗺️', moon: '🌙', mug: '☕', nest: '🪹', net: '🥅', octopus: '🐙', owl: '🦉',
  pen: '🖊️', pig: '🐷', queen: '👑', rabbit: '🐰', rat: '🐭', rug: '🧶', star: '⭐',
  sun: '☀️', tent: '⛺', top: '🪀', tree: '🌲', umbrella: '☂️', van: '🚐', web: '🕸️',
  worm: '🪱', yak: '🐃', 'yo-yo': '🪀', zebra: '🦓', zip: '🤐',
};

function emojiFor(word) {
  const key = String(word || '').toLowerCase().trim();
  return PICTURE_EMOJI[key] || '🌟';
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
        const [profile, rewardSettings] = await Promise.all([
          getProfile(profileId),
          getRewardSettings().catch(() => ({ rewardName: 'PS5', minutesPerToken: 5 })),
        ]);
        if (!alive) return;
        if (!profile) {
          router.go('#/kids', { replace: true });
          return;
        }
        const rewardName = rewardSettings?.rewardName || 'PS5';
        const theme = app?.setTheme ? (app.setTheme(profile.theme), getTheme(profile.theme)) : applyTheme(profile.theme);
        const game = await startPhonics(profile.id, { rounds: profile.settings?.sessionSize || 5 });
        if (!alive) return;
        gameRef = game;

        let idx = 0;
        const total = game.total || profile.settings?.sessionSize || 5;
        let roundState = 'playing'; // 'playing' | 'cheering'
        let revealHint = false;
        let builtLetters = '';
        let outcomes = [];

        const shell = el('div', { class: 'play-shell' });
        const hudMount = el('div');
        const bodyMount = el('div', { class: 'phonics-stage' });
        shell.append(hudMount, bodyMount);
        section.innerHTML = '';
        section.append(shell);

        const speakPrompt = (round) => {
          if (!round) return;
          if (round.type === 'find-letter') {
            speech.sayPhonics(round.letter);
          } else if (round.type === 'first-sound') {
            speech.say(`${round.picture}. What letter starts ${round.picture}?`, { rate: 0.9 });
          } else if (round.type === 'build') {
            speech.say(`Let's build ${round.word}!`, { rate: 0.85 });
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
          if (!alive) return;

          celebrateBurst({ style: profile.equipped?.fx || 'fx-rainbow-confetti' });
          section.className = 'screen screen--scroll is-active';
          section.innerHTML = '';
          section.append(
            el(
              'div',
              { class: 'page-wrap' },
              el(
                'div',
                { class: 'card', style: 'text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:30px 22px;' },
                el('div', { style: 'font-size:74px;' }, '🎉'),
                el('h1', { class: 'h1' }, `Way to go, ${profile.name}!`),
                el('div', { style: 'width:100%;max-width:320px;border-radius:18px;overflow:hidden;', html: renderThemeSceneSvg(theme.id) }),
                el(
                  'div',
                  { style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:10px;' },
                  el('span', { class: 'pill pill--accent' }, `+${summary.xp ?? 0} XP`),
                  el('span', { class: 'pill pill--gold' }, `+${summary.coins ?? 0} 🪙 Coins`),
                  summary.tokens > 0
                    ? el('span', { class: 'pill pill--success' }, `+${summary.minutesEarned ?? 0} ${summary.rewardName || rewardName} min earned!`)
                    : null
                ),
                el(
                  'div',
                  { style: 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:6px;' },
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
                  )
                )
              )
            )
          );
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

        // H2: Giant friendly visual "Tap to Play!" screen so round 1 speaks inside a tap
        const renderStartGate = () => {
          const firstRound = game.current();
          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: 'Phonics Explorer',
              currentIndex: 0,
              total,
              results: [],
            })
          );

          bodyMount.innerHTML = '';
          bodyMount.append(
            el(
              'div',
              { class: 'card start-card' },
              el('div', { style: 'font-size:84px;line-height:1;' }, '🎈🔊'),
              el('h1', { class: 'h1' }, `Ready, ${profile.name}?`),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary btn--lg btn--block',
                  style: 'min-height:86px;font-size:26px;',
                  onClick: () => {
                    speakPrompt(firstRound);
                    render();
                  },
                },
                '▶ Tap to Play!'
              )
            )
          );
        };

        const render = () => {
          const round = game.current();
          if (!round) {
            finishGame();
            return;
          }

          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: 'Phonics Explorer',
              currentIndex: idx,
              total,
              results: outcomes,
            })
          );

          bodyMount.innerHTML = '';

          // Prompt card (M5: prefer round.emoji from core engine!)
          const promptCard = el('div', { class: 'card phonics-prompt-card' });

          if (round.type === 'first-sound' || round.type === 'build') {
            const picWord = round.picture || round.word;
            const icon = round.emoji || emojiFor(picWord);
            promptCard.append(el('div', { class: 'phonics-picture', 'aria-hidden': 'true' }, icon));
          } else {
            promptCard.append(el('div', { class: 'phonics-picture', 'aria-hidden': 'true' }, '🔊'));
          }

          const titleText =
            round.type === 'find-letter'
              ? 'Tap the letter you hear!'
              : round.type === 'first-sound'
                ? `What letter starts "${round.picture}"?`
                : 'Build the word!';

          promptCard.append(
            el('h1', { class: 'h2' }, titleText),
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
            bodyMount.append(
              el(
                'div',
                { class: 'card', style: 'width:100%;max-width:620px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;' },
                el('h2', { class: 'h2' }, `🌟 ${pickRandom(theme.praise)}`),
                round.word ? el('div', { style: 'font-size:38px;font-weight:900;letter-spacing:0.12em;' }, round.word.toUpperCase()) : null,
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

          // Choice rounds: find-letter or first-sound (M3: answer & speak on click!)
          if (round.type === 'find-letter' || round.type === 'first-sound') {
            const choicesEl = el('div', { class: 'phonics-choices' });
            for (const ch of round.choices || []) {
              const isTarget = String(ch).toLowerCase() === String(round.letter).toLowerCase();
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
                      roundState = 'cheering';
                      celebrateBurst({ style: profile.equipped?.fx || 'default' });
                      speech.say(`Yes! ${String(ch).toUpperCase()}!`, { rate: 1.0 });
                      render();
                    } else {
                      btn.classList.add('is-wiggle');
                      window.setTimeout(() => btn.classList.remove('is-wiggle'), 360);
                      if (res.reveal) {
                        revealHint = true;
                        speech.sayPhonics(round.letter);
                        render();
                      } else {
                        speech.say(`That's ${String(ch).toUpperCase()}. Listen and try again!`, { rate: 0.95 });
                      }
                    }
                  },
                },
                String(ch).toUpperCase()
              );
              choicesEl.append(btn);
            }
            bodyMount.append(choicesEl);
            return;
          }

          // CVC word builder round ('build') — M3: answer & speak on click!
          const targetWord = String(round.word || '').toLowerCase();
          const slotsWrap = el(
            'div',
            { style: 'width:100%;max-width:640px;display:flex;flex-direction:column;align-items:center;gap:12px;' },
            renderLetterSlots({
              letters: builtLetters,
              targetLength: targetWord.length,
              showLength: true,
            })
          );

          const bank = el('div', { class: 'tile-bank' });
          const nextNeeded = targetWord[builtLetters.length];
          for (const ch of round.tiles || []) {
            const isHintTile = revealHint && String(ch).toLowerCase() === nextNeeded;
            bank.append(
              el(
                'button',
                {
                  type: 'button',
                  class: `bank-tile${isHintTile ? ' is-hint' : ''}`,
                  onClick: () => {
                    if (builtLetters.length >= targetWord.length) return;
                    builtLetters += String(ch).toLowerCase();
                    speech.sayLetter(ch);

                    if (builtLetters.length === targetWord.length) {
                      const res = game.answer(builtLetters);
                      if (!res) return;
                      answeredAny = true;
                      if (res.correct) {
                        outcomes[idx] = true;
                        roundState = 'cheering';
                        celebrateBurst({ style: profile.equipped?.fx || 'default' });
                        speech.say(`${targetWord}! Awesome!`, { rate: 0.95 });
                        render();
                        return;
                      }
                      builtLetters = '';
                      if (res.reveal) {
                        revealHint = true;
                      }
                      speech.say(`Almost! Listen closely: ${targetWord}`, { rate: 0.85 });
                    }
                    render();
                  },
                },
                String(ch).toUpperCase()
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
