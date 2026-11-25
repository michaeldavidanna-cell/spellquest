/**
 * Screen 4: Competition "On Stage" Mode (5th Grade Round 2 Prep)
 * Follows 2027 Suggested Rules (T2 §4):
 * - Tap-to-Start overlay starts Word 1 speech & timer inside the tap (H2)
 * - Word is spoken only, never shown before attempt; free-growing strip (no length spoiler)
 * - Exact 6 official bee asks (Repeat + 5 field asks, hidden when empty)
 * - Gentle countdown timer that signals time-up without erasing the attempt
 * - No per-letter TTS churn on Stage (M3), enabled big Next button (M8), finish guard (H1),
 *   abandon/save on leave (M1), dynamic rewardName (L7).
 */

import { getProfile } from '../store/profiles.js';
import { getRewardSettings } from '../rewards/wallet.js';
import { startSession } from '../engine/runner.js';
import { hasClue } from '../engine/wordlist.js';
import { speech } from '../audio/speech.js';
import {
  celebrateBurst,
  el,
  formatSeconds,
  maskWordInText,
  renderLetterDiff,
  renderLetterSlots,
  renderPlayHud,
  showToast,
  speakerSvg,
} from '../ui/components.js';
import { createKeyboard } from '../ui/keyboard.js';
import { applyTheme, getAvatarEmoji, getTheme, pickRandom, renderThemeSceneSvg } from '../ui/themes.js';

const OFFICIAL_ASKS = [
  { kind: 'definition', label: 'Definition' },
  { kind: 'sentence', label: 'Sentence' },
  { kind: 'partOfSpeech', label: 'Part of Speech' },
  { kind: 'origin', label: 'Origin' },
  { kind: 'altPronunciation', label: 'Other Pronunciation' },
];

function formatOfficialClue(word, kind) {
  switch (kind) {
    case 'definition':
      return { tag: 'Judge • Definition', text: maskWordInText(word.definitions?.[0] || '', word.word) };
    case 'sentence':
      return { tag: 'Judge • Sentence', text: maskWordInText(word.sentence || '', word.word) };
    case 'partOfSpeech':
      return { tag: 'Judge • Part of Speech', text: word.partOfSpeech || '' };
    case 'origin':
      return { tag: 'Judge • Language of Origin', text: word.origin || '' };
    case 'altPronunciation':
      return { tag: 'Judge • Another Pronunciation', text: word.altPronunciation || '' };
    default:
      return {
        tag: 'Pronouncer',
        text: 'Listen closely. Tap any official clue button above if you need it.',
      };
  }
}

export function CompetitionScreen({ router, app }) {
  return {
    mount(rootEl, params) {
      let alive = true;
      const profileId = params?.profileId;
      const section = el('section', { class: 'screen screen--play is-active', dataset: { screen: 'competition' } });
      rootEl.innerHTML = '';
      rootEl.append(section);

      let keyboard = null;
      let session = null;
      let offSpeech = null;
      let speechStatus = 'idle';
      let answeredAny = false;
      let finished = false;
      let finishing = false;

      const cleanup = () => {
        alive = false;
        if (session?.timer) session.timer.stop();
        if (keyboard) keyboard.destroy();
        if (offSpeech) offSpeech();
        if (session && answeredAny && !finished && !finishing) {
          finishing = true;
          if (typeof session.abandon === 'function') session.abandon();
          else session.finish().catch(() => {});
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
        session = await startSession(profile.id, {
          kind: 'stage',
          size: profile.settings?.sessionSize || 12,
        });
        if (!alive) return;

        if (!session.words || session.words.length === 0) {
          section.className = 'screen screen--scroll is-active';
          section.innerHTML = '';
          section.append(
            el(
              'div',
              { class: 'page-wrap' },
              el(
                'div',
                { class: 'card', style: 'text-align:center;padding:34px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;' },
                el('div', { style: 'font-size:52px;' }, '🎤'),
                el('h1', { class: 'h2' }, 'No Stage Words Loaded Yet'),
                el('p', { class: 'muted', style: 'margin:0;max-width:460px;font-size:17px;' }, 'Open Parent Area to import the Round 2 word list.'),
                el(
                  'button',
                  { type: 'button', class: 'btn btn--primary btn--lg', onClick: () => router.go(`#/home/${encodeURIComponent(profile.id)}`) },
                  '◀ Back to Map'
                )
              )
            )
          );
          return;
        }

        let letters = '';
        let phase = 'spelling'; // 'spelling' | 'verdict'
        let lastResult = null;
        let activeClue = null;
        let timeUp = false;
        let roundOutcomes = [];
        let speakHeroBtn = null;
        let speechRecoveryBtn = null;
        let timerPill = null;

        const playShell = el('div', { class: 'play-shell' });
        const hudMount = el('div');
        const stageMount = el('div', { class: 'play-stage' });
        const kbMount = el('div');
        playShell.append(hudMount, stageMount, kbMount);
        section.innerHTML = '';
        section.append(playShell);

        if (app?.events) {
          offSpeech = app.events.on('speech:state', (detail) => {
            speechStatus = detail?.state || 'idle';
            if (speakHeroBtn) speakHeroBtn.classList.toggle('is-speaking', speechStatus === 'speaking');
            if (speechRecoveryBtn) speechRecoveryBtn.hidden = speechStatus !== 'stalled';
            if (speechStatus === 'novoice') {
              showToast('No speech voice available — ask clues stay shown on screen.');
            }
          });
        }

        const leaveToMap = async (btn) => {
          if (finishing) return;
          if (btn) btn.disabled = true;
          if (session.timer) session.timer.stop();
          if (answeredAny && !finished) {
            finishing = true;
            try {
              if (typeof session.abandon === 'function') await session.abandon();
              else await session.finish();
              finished = true;
              showToast('Progress & stars saved!', { tone: 'gold' });
            } catch {
              // ignore exit save error
            }
          }
          router.go(`#/home/${encodeURIComponent(profile.id)}`);
        };

        const startWordTimer = () => {
          timeUp = false;
          if (!session.timer) return;
          session.timer.stop();
          session.timer.start(
            (remaining) => {
              if (!alive || !timerPill) return;
              timerPill.textContent = `⏱ ${formatSeconds(remaining)}`;
              timerPill.classList.toggle('is-low', remaining <= 12);
            },
            () => {
              if (!alive) return;
              timeUp = true;
              if (timerPill) {
                timerPill.textContent = '⏱ Time';
                timerPill.classList.add('is-low');
              }
              // T2 §4: running out of time NEVER wipes the child's try
              showToast('Clock finished — take a breath and lock in your spelling!', { tone: 'gold' });
            }
          );
        };

        const renderSummary = async () => {
          if (finishing || finished) return;
          finishing = true;
          if (session.timer) session.timer.stop();
          if (keyboard) {
            keyboard.setDisabled(true);
            keyboard.setSubmitEnabled(false);
            keyboard.destroy();
            keyboard = null;
          }
          const summary = await session.finish();
          finished = true;
          if (!alive) return;

          celebrateBurst({ style: profile.equipped?.fx || 'default' });
          section.className = 'screen screen--scroll is-active';
          section.innerHTML = '';

          const wrap = el('div', { class: 'page-wrap' });
          wrap.append(
            el(
              'div',
              { class: 'card card--stage', style: 'text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:28px 22px;' },
              el('span', { class: 'pill pill--gold' }, '🎤 ON STAGE RUN COMPLETE'),
              el('h1', { class: 'h1' }, `${summary.correct} of ${summary.answered} Correct!`),
              el(
                'p',
                { class: 'muted', style: 'margin:0;font-size:18px;font-weight:700;' },
                `Stage Accuracy: ${Math.round((summary.accuracy || 0) * 100)}% • Streak: ${summary.streak ?? profile.streak?.count ?? 0} days`
              ),
              el(
                'div',
                { style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:10px;' },
                el('span', { class: 'pill pill--accent' }, `+${summary.xp ?? 0} XP`),
                el('span', { class: 'pill pill--gold' }, `+${summary.coins ?? 0} 🪙 Coins`),
                summary.tokens > 0
                  ? el(
                      'span',
                      { class: 'pill pill--success' },
                      `+${summary.tokens} token${summary.tokens === 1 ? '' : 's'} (${summary.minutesEarned ?? 0} ${summary.rewardName || rewardName} min!)`
                    )
                  : summary.tokenCapped
                    ? el('span', { class: 'pill' }, 'Daily token cap reached — great bee prep!')
                    : null
              ),
              summary.newlyMastered?.length
                ? el('div', { class: 'pill pill--success' }, `Mastered: ${summary.newlyMastered.join(', ')}`)
                : null,
              el(
                'div',
                { style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:8px;' },
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    onClick: () => router.go(`#/home/${encodeURIComponent(profile.id)}`),
                  },
                  '◀ Back to Map'
                ),
                summary.fixitLeft > 0
                  ? el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--highlight btn--lg',
                        onClick: () => router.go(`#/mistakes/${encodeURIComponent(profile.id)}`),
                      },
                      `🛠️ Review ${summary.fixitLeft} Tricky Words`
                    )
                  : null
              )
            )
          );
          section.append(wrap);
        };

        const advanceToNext = () => {
          if (finishing || finished) return;
          const nextWord = session.next();
          if (!nextWord) {
            renderSummary();
            return;
          }
          letters = '';
          phase = 'spelling';
          lastResult = null;
          activeClue = null;
          // Speak next word synchronously inside tap
          speech.sayWord(nextWord);
          renderWord();
          startWordTimer();
        };

        const handleSubmit = () => {
          if (finishing || finished) return;
          const word = session.current();
          if (!word || !letters.trim() || phase !== 'spelling') return;
          if (session.timer) session.timer.stop();

          const result = session.submit(letters);
          if (!result) return;
          answeredAny = true;
          lastResult = result;
          phase = 'verdict';
          roundOutcomes[session.index] = result.correct;

          if (result.correct) {
            celebrateBurst({ style: profile.equipped?.fx || 'default' });
            speech.say('Correct!', { rate: 1.0 });
          } else {
            speech.sayWordSpelled(word);
          }
          renderWord();
        };

        // H2: Big "Step Up to the Mic" overlay so Word 1 speech & timer start on tap
        const renderStartGate = () => {
          const firstWord = session.current();
          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: 'On Stage • Round 2',
              currentIndex: 0,
              total: session.total,
              results: [],
            })
          );

          stageMount.className = 'start-overlay';
          stageMount.innerHTML = '';
          kbMount.innerHTML = '';

          stageMount.append(
            el(
              'div',
              { class: 'card card--stage start-card' },
              el('span', { class: 'pill pill--gold' }, '🎤 ROUND 2 • ON STAGE'),
              el('h1', { class: 'h1' }, 'Ready at the Microphone?'),
              el(
                'p',
                { class: 'muted', style: 'margin:0;font-size:17px;' },
                `${session.total} words • Official bee asks • ${session.timer ? `${session.timer.limitSec}s gentle clock` : 'No timer'}. Tap below to hear Word 1!`
              ),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary btn--lg btn--block',
                  onClick: () => {
                    stageMount.className = 'play-stage';
                    // Speak Word 1 synchronously inside tap + start Word 1 timer (H2)
                    speech.sayWord(firstWord);
                    renderWord();
                    startWordTimer();
                  },
                },
                '🎤 Start & Hear Word 1'
              )
            )
          );
        };

        const renderWord = () => {
          const word = session.current();
          if (!word) return;

          timerPill = session.timer
            ? el(
                'span',
                { class: `timer-pill${timeUp ? ' is-low' : ''}` },
                `⏱ ${formatSeconds(session.timer.remaining ? session.timer.remaining() : session.timer.limitSec)}`
              )
            : null;

          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: 'On Stage • Round 2',
              currentIndex: session.index,
              total: session.total,
              results: roundOutcomes,
              timerEl: timerPill,
            })
          );

          // Left column: Pronouncer & Official 6 Asks (T2 §4)
          const audioPanel = el('div', { class: 'card card--stage audio-panel' });

          speakHeroBtn = el(
            'button',
            {
              type: 'button',
              class: `speak-hero${speechStatus === 'speaking' ? ' is-speaking' : ''}`,
              onClick: () => speech.sayWord(word),
            },
            el('span', { class: 'speaker-ring', html: speakerSvg(30) }),
            el(
              'span',
              { class: 'speak-hero__text' },
              el('strong', {}, 'Say the Word Again'),
              el('small', {}, 'Official Pronouncer')
            )
          );

          speechRecoveryBtn = el(
            'button',
            {
              type: 'button',
              class: 'btn btn--highlight btn--sm btn--block',
              hidden: speechStatus !== 'stalled',
              onClick: () => speech.replay(),
            },
            '🔊 Voice paused — Tap to hear it again'
          );

          const clueGrid = el('div', { class: 'clue-grid', role: 'group', 'aria-label': 'Official bee asks' });
          for (const ask of OFFICIAL_ASKS) {
            if (!hasClue(word, ask.kind)) continue;
            clueGrid.append(
              el(
                'button',
                {
                  type: 'button',
                  class: `clue-btn${activeClue === ask.kind ? ' is-active' : ''}`,
                  onClick: () => {
                    activeClue = ask.kind;
                    speech.sayClue(word, ask.kind);
                    renderWord();
                  },
                },
                ask.label
              )
            );
          }

          const caption = formatOfficialClue(word, activeClue);
          const clueBox = el(
            'div',
            { class: 'clue-box' },
            el('span', { class: 'clue-box__label' }, caption.tag),
            el('p', { class: 'clue-box__text' }, caption.text)
          );

          audioPanel.append(
            el('span', { class: 'pill pill--gold', style: 'align-self:flex-start;' }, '🎤 ROUND 2 • ON STAGE'),
            speakHeroBtn,
            speechRecoveryBtn,
            clueGrid,
            clueBox
          );

          // Right column: Free-growing Stage Strip (no length hints!) + Verdict
          const wordPanel = el('div', { class: 'card word-panel' });

          const doneCount = roundOutcomes.filter(Boolean).length;
          const worldStrip = el(
            'div',
            { class: 'world-strip' },
            el('div', { class: 'world-strip__art', html: renderThemeSceneSvg(theme.id, { compact: true }) }),
            el(
              'div',
              { class: 'world-strip__copy' },
              el('span', { class: 'world-strip__kicker' }, `${theme.name} • Stage Run`),
              el('span', { class: 'world-strip__status' }, `${doneCount} of ${session.index + (phase === 'verdict' ? 1 : 0)} correct so far`)
            )
          );

          const slotsArea = el('div', { class: 'slots-area' });
          if (phase === 'spelling') {
            slotsArea.append(
              el('span', { class: 'muted', style: 'font-size:13px;font-weight:700;' }, 'Stage Strip (no word-length hints)'),
              renderLetterSlots({
                letters,
                targetLength: 0,
                showLength: false,
              })
            );
          } else if (lastResult) {
            if (lastResult.correct) {
              slotsArea.append(
                el('span', { class: 'pill pill--success' }, `Official spelling: ${lastResult.target}`),
                renderLetterSlots({
                  letters: lastResult.target,
                  targetLength: lastResult.target.length,
                  showLength: true,
                  marks: lastResult.targetMarks,
                })
              );
            } else {
              slotsArea.append(renderLetterDiff(lastResult));
            }
          }

          const isLastWord = session.index + 1 >= session.total;
          const nextLabel = isLastWord ? 'Finish Stage Run →' : 'Next Word →';

          let coachBar;
          if (phase === 'spelling') {
            const beeNote = profile.settings?.beeRules
              ? 'Bee Rules ON: no backspace — think before tapping each letter!'
              : 'Tip: At the real bee, say the word before & after — and avoid backing up to change a letter.';
            coachBar = el('div', { class: 'coach-bar' }, el('span', {}, beeNote));
          } else if (lastResult?.correct) {
            coachBar = el(
              'div',
              { class: 'coach-bar coach-bar--success' },
              el('span', {}, `🌟 Correct! ${pickRandom(theme.praise)}`),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary',
                  disabled: finishing,
                  onClick: () => advanceToNext(),
                },
                nextLabel
              )
            );
          } else {
            const partial =
              lastResult?.lettersRightFromStart > 0
                ? `Learn it: you had the first ${lastResult.lettersRightFromStart} letter${lastResult.lettersRightFromStart === 1 ? '' : 's'} right! Added to Fix-It.`
                : 'Learn it: saved to your Fix-It list so you will nail it next time!';
            coachBar = el(
              'div',
              { class: 'coach-bar' },
              el('span', {}, partial),
              el(
                'div',
                { style: 'display:flex;gap:8px;flex-shrink:0;' },
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost',
                    onClick: () => speech.sayWordSpelled(word),
                  },
                  '🔊 Hear Letters'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary',
                    disabled: finishing,
                    onClick: () => advanceToNext(),
                  },
                  nextLabel
                )
              )
            );
          }

          wordPanel.append(worldStrip, slotsArea, coachBar);

          stageMount.innerHTML = '';
          stageMount.append(audioPanel, wordPanel);

          // Keyboard dock (M3: no per-letter TTS churn on Stage; M8: primary button advances in verdict!)
          const beeRules = Boolean(profile.settings?.beeRules);
          const kbLayout = profile.settings?.keyboard === 'abc' ? 'abc' : 'qwerty';
          const kbPrimaryHandler = phase === 'verdict' ? advanceToNext : handleSubmit;
          const kbPrimaryLabel = phase === 'verdict' ? nextLabel : "I'm Done Spelling ✓";

          if (!keyboard) {
            keyboard = createKeyboard({
              layout: kbLayout,
              beeRules,
              submitLabel: kbPrimaryLabel,
              showPunctuation: false,
              onLetter: (ch) => {
                if (phase !== 'spelling') return;
                letters += ch;
                updateStripOnly();
              },
              onBackspace: () => {
                if (phase !== 'spelling' || beeRules || !letters.length) return;
                letters = letters.slice(0, -1);
                updateStripOnly();
              },
              onClear: () => {
                if (phase !== 'spelling' || beeRules) return;
                letters = '';
                updateStripOnly();
              },
              onRepeat: () => speech.sayWord(session.current()),
              onSubmit: kbPrimaryHandler,
            });
            kbMount.innerHTML = '';
            kbMount.append(keyboard.el);
          } else {
            keyboard.update({
              layout: kbLayout,
              beeRules,
              submitLabel: kbPrimaryLabel,
              showPunctuation: false,
              onSubmit: kbPrimaryHandler,
            });
          }

          keyboard.setDisabled(phase !== 'spelling');
          keyboard.setSubmitEnabled(
            !finishing && (phase === 'verdict' || (phase === 'spelling' && letters.length > 0))
          );
        };

        const updateStripOnly = () => {
          const area = stageMount.querySelector('.slots-area');
          if (area) {
            area.innerHTML = '';
            area.append(
              el('span', { class: 'muted', style: 'font-size:13px;font-weight:700;' }, 'Stage Strip (no word-length hints)'),
              renderLetterSlots({ letters, targetLength: 0, showLength: false })
            );
          }
          if (keyboard) keyboard.setSubmitEnabled(!finishing && phase === 'spelling' && letters.length > 0);
        };

        renderStartGate();
      };

      boot();
      return cleanup;
    },
  };
}
