/**
 * Screen 3: Practice Round (and Fix-It Review round)
 * Zero-scroll iPad layout (portrait & landscape), custom on-screen keyboard,
 * T2 §4 clue buttons (hidden when field is empty), non-punishing letter diff & retry.
 * Includes H1 (finish guard), H2 (Tap to Start), M1 (abandon/save on leave),
 * M2 (assisted peek flag), M8 (enabled big Next button + 56px coach buttons), L7 (rewardName).
 */

import { getProfile } from '../store/profiles.js';
import { getRewardSettings, getWallet } from '../rewards/wallet.js';
import { startSession } from '../engine/runner.js';
import { hasSafeClue as hasClue, clueText, safeCaption } from '../engine/clues.js'; // A1: leak-safe clue text
import { speech } from '../audio/speech.js';
import {
  el,
  renderLetterDiff,
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
import { createKeyboard } from '../ui/keyboard.js';
import { applyTheme, getAvatarEmoji, getTheme, pickRandom, renderThemeSceneSvg } from '../ui/themes.js';

const CLUE_DEFS = [
  { kind: 'definition', label: 'Definition' },
  { kind: 'sentence', label: 'Sentence' },
  { kind: 'partOfSpeech', label: 'Part of Speech' },
  { kind: 'origin', label: 'Origin' },
  { kind: 'altPronunciation', label: 'Other Pronunciation' },
  { kind: 'syllables', label: 'Syllables' },
];

function buildGuidedTiles(wordStr) {
  const letters = Array.from(String(wordStr || '').toLowerCase()).filter((c) => /[a-z]/.test(c));
  const pool = 'aeiourstlnmpbcdghk';
  const extras = [];
  for (const ch of pool) {
    if (extras.length >= 3) break;
    if (!letters.includes(ch)) extras.push(ch);
  }
  const combined = [...letters, ...extras];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

function clueCaption(word, kind) {
  // A1: all clue text comes from engine/clues.js, which never shows the spelling.
  switch (kind) {
    case 'definition':
      return { tag: 'Definition', text: clueText(word, 'definition') };
    case 'sentence':
      return { tag: 'Sentence', text: clueText(word, 'sentence') };
    case 'partOfSpeech':
      return { tag: 'Part of Speech', text: clueText(word, 'partOfSpeech') };
    case 'origin':
      return { tag: 'Language of Origin', text: clueText(word, 'origin') };
    case 'altPronunciation':
      return { tag: 'Another Pronunciation', text: clueText(word, 'altPronunciation') };
    case 'syllables':
      return { tag: 'Syllable Hint', text: clueText(word, 'syllables') };
    default:
      return { tag: 'Ready', text: 'Tap "Hear the Word" or pick any clue button above.' };
  }
}

export function PracticeScreen({ router, app }) {
  return {
    mount(rootEl, params) {
      let alive = true;
      const profileId = params?.profileId;
      const kind = params?.kind === 'review' ? 'review' : 'practice';
      const section = el('section', { class: 'screen screen--play is-active', dataset: { screen: 'practice' } });
      rootEl.innerHTML = '';
      rootEl.append(section);

      let keyboard = null;
      let peekTimer = null;
      let offSpeech = null;
      let speechStatus = 'idle';
      let sessionRef = null;
      let answeredAny = false;
      let finished = false;
      let finishing = false;

      const cleanup = () => {
        alive = false;
        if (peekTimer) window.clearTimeout(peekTimer);
        if (keyboard) keyboard.destroy();
        if (offSpeech) offSpeech();
        if (sessionRef && answeredAny && !finished && !finishing) {
          finishing = true;
          if (typeof sessionRef.abandon === 'function') sessionRef.abandon();
          else sessionRef.finish().catch(() => {});
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
        const session = await startSession(profile.id, {
          kind,
          size: profile.settings?.sessionSize,
        });
        if (!alive) return;
        sessionRef = session;

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
                el('div', { style: 'font-size:52px;' }, kind === 'review' ? '🌟' : '📚'),
                el('h1', { class: 'h2' }, kind === 'review' ? 'All Fix-It Words Cleared!' : 'No Words Loaded Yet'),
                el(
                  'p',
                  { class: 'muted', style: 'margin:0;max-width:460px;font-size:17px;' },
                  kind === 'review'
                    ? 'You have no tricky words waiting in review right now. Great job!'
                    : 'Ask a parent to open the Parent Area and import a word list.'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    onClick: () => router.go(`#/home/${encodeURIComponent(profile.id)}`),
                  },
                  '◀ Back to Map'
                )
              )
            )
          );
          return;
        }

        let started = false;
        let letters = '';
        let phase = 'typing'; // 'typing' | 'retry' | 'resolved'
        let lastResult = null;
        let activeClue = null;
        let peekActive = false;
        let peekedThisWord = false;
        let roundOutcomes = [];
        let streakInRound = 0;
        let bestStreak = 0;
        let speechRecoveryBtn = null;
        let speakHeroBtn = null;

        const playShell = el('div', { class: 'play-shell' });
        const hudMount = el('div');
        const stageMount = el('div', { class: 'play-stage' });
        const kbMount = el('div');
        playShell.append(hudMount, stageMount, kbMount);
        section.innerHTML = '';
        section.append(playShell);

        const updateSpeechStateUi = (detail) => {
          speechStatus = detail?.state || 'idle';
          if (speakHeroBtn) {
            speakHeroBtn.classList.toggle('is-speaking', speechStatus === 'speaking');
          }
          if (speechRecoveryBtn) {
            speechRecoveryBtn.hidden = speechStatus !== 'stalled';
          }
          if (speechStatus === 'novoice') {
            showToast('No speech voice on device — clues stay visible on screen.');
          }
        };

        if (app?.events) {
          offSpeech = app.events.on('speech:state', updateSpeechStateUi);
        }

        const leaveToMap = async (btn) => {
          if (finishing) return;
          if (btn) btn.disabled = true;
          if (answeredAny && !finished) {
            finishing = true;
            try {
              if (typeof session.abandon === 'function') await session.abandon();
              else await session.finish();
              finished = true;
              showToast('Progress & stars saved!', { tone: 'gold' });
            } catch {
              // ignore save error on exit
            }
          }
          router.go(`#/home/${encodeURIComponent(profile.id)}`);
        };

        const renderSummary = async () => {
          if (finishing || finished) return;
          finishing = true;
          if (keyboard) {
            keyboard.setDisabled(true);
            keyboard.setSubmitEnabled(false);
            keyboard.destroy();
            keyboard = null;
          }
          const summary = await session.finish();
          finished = true;
          const afterWallet = await getWallet(profile.id).catch(() => ({ level: startLevel }));
          if (!alive) return;

          const newLevel = afterWallet?.level || startLevel;
          const leveledUp = newLevel > startLevel;
          if (leveledUp) {
            playLevelUpBurst({ level: newLevel, themeId: theme.id });
          } else {
            playThemeCelebration({
              themeId: theme.id,
              streak: Math.max(bestStreak, summary.correct >= 3 ? 3 : 1),
              fxStyle: profile.equipped?.fx || 'default',
            });
          }

          section.className = 'screen screen--scroll is-active';
          section.innerHTML = '';

          const wrap = el('div', { class: 'page-wrap' });
          wrap.append(
            renderTrophySummaryCard({
              themeId: theme.id,
              title: theme.summaryTitle,
              subtitle: `${summary.correct} of ${summary.answered} spelled right (${Math.round((summary.accuracy || 0) * 100)}%)`,
              summary,
              rewardName,
              bestStreak,
              leveledUp,
              newLevel,
              actions: [
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    onClick: () => router.go(`#/home/${encodeURIComponent(profile.id)}`),
                  },
                  '◀ Back to World Map'
                ),
                summary.fixitLeft > 0
                  ? el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--highlight btn--lg',
                        onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/review`),
                      },
                      `🛠️ Review ${summary.fixitLeft} Fix-It Words`
                    )
                  : null,
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--lg',
                    onClick: () => router.go(`#/rewards/${encodeURIComponent(profile.id)}`),
                  },
                  '🎮 Rewards Shop'
                ),
              ],
            })
          );
          section.append(wrap);
        };

        const advanceToNext = () => {
          if (finishing || finished) return;
          if (peekTimer) {
            window.clearTimeout(peekTimer);
            peekTimer = null;
          }
          const nextWord = session.next();
          if (!nextWord) {
            renderSummary();
            return;
          }
          letters = '';
          phase = 'typing';
          lastResult = null;
          activeClue = null;
          peekActive = false;
          peekedThisWord = false;
          // Speak next word synchronously inside the tap!
          speech.sayWord(nextWord);
          renderWord();
        };

        const handleSubmit = () => {
          if (finishing || finished) return;
          const word = session.current();
          if (!word || !letters.trim() || phase === 'resolved') return;

          // SYNC grade call so speech starts inside the same tap (M2: pass assisted flag after Peek)
          const result = session.submit(letters, peekedThisWord ? { assisted: true } : undefined);
          if (!result) return;
          answeredAny = true;
          lastResult = result;

          if (result.correct) {
            roundOutcomes[session.index] = true;
            phase = 'resolved';
            if (!peekedThisWord) {
              streakInRound += 1;
              bestStreak = Math.max(bestStreak, streakInRound);
            }
            const praiseLine = pickRandom(theme.praise);
            playThemeCelebration({
              themeId: theme.id,
              streak: peekedThisWord ? 1 : streakInRound,
              fxStyle: profile.equipped?.fx || 'default',
              label: praiseLine,
            });
            speech.say(praiseLine, { rate: 1.0 });
            if (result.fixit?.cleared) {
              showToast('Fix-It word cleared! Bonus XP!', { tone: 'gold' });
            }
          } else if (session.canRetry()) {
            streakInRound = 0;
            phase = 'retry';
            speech.sayWord(word, { slow: true });
          } else {
            streakInRound = 0;
            roundOutcomes[session.index] = false;
            phase = 'resolved';
            speech.sayLetters(result.target || word.word);
          }
          renderWord();
        };

        // H2: Big "Tap to Start" overlay so word 1 speech runs inside a real user tap
        const renderStartGate = () => {
          const firstWord = session.current();
          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: kind === 'review' ? 'Fix-It Review' : 'Practice Round',
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
              { class: 'card start-card' },
              el('div', { class: 'start-card__scene', html: renderThemeSceneSvg(theme.id) }),
              el('h1', { class: 'h1' }, kind === 'review' ? 'Fix-It Review Ready!' : 'Practice Round Ready!'),
              el(
                'p',
                { class: 'muted', style: 'margin:0;font-size:17px;' },
                `${session.total} word${session.total === 1 ? '' : 's'} lined up in ${theme.name}. Tap below to hear your first word!`
              ),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary btn--lg btn--block',
                  onClick: () => {
                    started = true;
                    stageMount.className = 'play-stage';
                    // Synchronously speak word 1 inside this tap (H2)
                    speech.sayWord(firstWord);
                    renderWord();
                  },
                },
                '🔊 Start & Hear Word 1'
              )
            )
          );
        };

        const renderWord = () => {
          const word = session.current();
          if (!word) return;

          // Top HUD
          hudMount.innerHTML = '';
          hudMount.append(
            renderPlayHud({
              backLabel: 'Map',
              onBack: (e) => leaveToMap(e.currentTarget),
              avatar: getAvatarEmoji(profile.avatar),
              profileName: profile.name,
              modeLabel: kind === 'review' ? 'Fix-It Review' : 'Practice Round',
              currentIndex: session.index,
              total: session.total,
              results: roundOutcomes,
              rightExtra: el(
                'button',
                {
                  type: 'button',
                  class: 'hud-btn',
                  disabled: finishing,
                  onClick: () => {
                    if (phase === 'resolved') {
                      advanceToNext();
                    } else {
                      answeredAny = true;
                      session.skip();
                      roundOutcomes[session.index] = false;
                      advanceToNext();
                    }
                  },
                },
                'Skip ⏭'
              ),
            })
          );

          // Left column: Audio & Clues
          const audioPanel = el('div', { class: 'card audio-panel' });

          const hasNaturalClip = typeof speech.hasClip === 'function' && speech.hasClip(word, 'word');
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
              el('strong', {}, 'Hear the Word'),
              el('small', {}, hasNaturalClip ? '🎙️ Natural voice • Tap anytime' : 'Tap anytime to listen again')
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

          const allowedClues =
            Array.isArray(profile.settings?.clues) && profile.settings.clues.length
              ? new Set(profile.settings.clues)
              : null;
          const clueGrid = el('div', { class: 'clue-grid', role: 'group', 'aria-label': 'Word clues' });

          clueGrid.append(
            el(
              'button',
              {
                type: 'button',
                class: 'clue-btn',
                onClick: () => speech.sayWord(word, { slow: true }),
              },
              '🐢 Slow'
            )
          );

          for (const c of CLUE_DEFS) {
            if (!hasClue(word, c.kind)) continue;
            if (allowedClues && !allowedClues.has(c.kind) && c.kind !== 'syllables') continue;
            clueGrid.append(
              el(
                'button',
                {
                  type: 'button',
                  class: `clue-btn${activeClue === c.kind ? ' is-active' : ''}`,
                  onClick: () => {
                    activeClue = c.kind;
                    if (c.kind === 'syllables') {
                      speech.sayWord(word, { slow: true });
                    } else {
                      speech.sayClue(word, c.kind);
                    }
                    renderWord();
                  },
                },
                c.label
              )
            );
          }

          if (phase === 'typing') {
            clueGrid.append(
              el(
                'button',
                {
                  type: 'button',
                  class: `clue-btn${peekActive ? ' is-active' : ''}`,
                  onClick: () => {
                    peekActive = true;
                    peekedThisWord = true;
                    if (typeof session.peek === 'function') session.peek();
                    speech.sayWord(word);
                    renderWord();
                    if (peekTimer) window.clearTimeout(peekTimer);
                    peekTimer = window.setTimeout(() => {
                      peekActive = false;
                      if (alive) renderWord();
                    }, 2000);
                  },
                },
                '👀 Peek (2s)'
              )
            );
          }

          const caption = peekActive
            ? { tag: 'Quick Peek (practice assist — hides in 2s)', text: word.word }
            : clueCaption(word, activeClue);
          const displayCaptionText = peekActive
            ? caption.text
            : (caption.text || safeCaption('Tap "Hear the Word" or a clue button.', word));

          const clueBox = el(
            'div',
            { class: 'clue-box' },
            el('span', { class: 'clue-box__label' }, caption.tag),
            el(
              'p',
              { class: 'clue-box__text', style: peekActive ? 'font-size:26px;font-weight:800;letter-spacing:0.06em;' : '' },
              displayCaptionText
            )
          );

          audioPanel.append(speakHeroBtn, speechRecoveryBtn, clueGrid, clueBox);

          // Right column: Theme banner + Letter Slots / Diff + Coach Feedback
          const wordPanel = el('div', { class: 'card word-panel' });

          const doneCount = roundOutcomes.filter(Boolean).length;
          const pct = Math.round(((session.index + (phase === 'resolved' ? 1 : 0)) / Math.max(1, session.total)) * 100);
          const worldStrip = el(
            'div',
            { class: 'world-strip' },
            el('div', { class: 'world-strip__art', html: renderThemeSceneSvg(theme.id, { compact: true }) }),
            el(
              'div',
              { class: 'world-strip__copy' },
              el('span', { class: 'world-strip__kicker' }, theme.kicker),
              el('span', { class: 'world-strip__status' }, theme.milestoneLabel(doneCount, session.total)),
              el('div', { class: 'meter', style: 'height:8px;' }, el('div', { class: 'meter__fill', style: `width:${Math.max(8, pct)}%` }))
            )
          );

          const slotsArea = el('div', { class: 'slots-area' });
          if (phase === 'typing') {
            slotsArea.append(
              renderLetterSlots({
                letters,
                targetLength: word.word.length,
                showLength: profile.settings?.showLength !== false,
              })
            );
          } else if (phase === 'retry' && lastResult) {
            slotsArea.append(renderLetterDiff(lastResult));
          } else if (phase === 'resolved' && lastResult) {
            if (lastResult.correct) {
              slotsArea.append(
                renderLetterSlots({
                  letters: lastResult.target || word.word,
                  targetLength: (lastResult.target || word.word).length,
                  showLength: true,
                  marks: lastResult.targetMarks,
                })
              );
            } else {
              slotsArea.append(renderLetterDiff(lastResult));
            }
          }

          const isLastWord = session.index + 1 >= session.total;
          const nextLabel = isLastWord ? 'Finish Round →' : 'Next Word →';

          let coachBar;
          if (phase === 'typing') {
            coachBar = el(
              'div',
              { class: 'coach-bar' },
              el(
                'span',
                {},
                peekedThisWord
                  ? '👀 Peek used — great practice rep! Try without peek next time for mastery.'
                  : '✦ Tap letters below, then tap Spell It!'
              ),
              word.homophones?.length ? el('span', { class: 'pill' }, 'Tip: Check Definition!') : null
            );
          } else if (phase === 'retry') {
            coachBar = el(
              'div',
              { class: 'coach-bar' },
              el('span', {}, pickRandom(theme.retryPrompt)),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary',
                  onClick: () => {
                    letters = '';
                    phase = 'typing';
                    speech.sayWord(word);
                    renderWord();
                  },
                },
                'Try Again'
              )
            );
          } else if (lastResult?.correct) {
            coachBar = el(
              'div',
              { class: 'coach-bar coach-bar--success' },
              el(
                'span',
                {},
                `🌟 ${pickRandom(theme.praise)} (+${lastResult.reward?.xp ?? 0} XP${peekedThisWord ? ' • Peek practice' : ''})`
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
            );
          } else {
            coachBar = el(
              'div',
              { class: 'coach-bar' },
              el(
                'span',
                {},
                lastResult?.lettersRightFromStart > 0
                  ? `Nice try — you got the first ${lastResult.lettersRightFromStart} letter${lastResult.lettersRightFromStart === 1 ? '' : 's'} right!`
                  : theme.learnPrompt
              ),
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
                  '🔊 Spell'
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

          // Keyboard dock (M8: primary action button stays ENABLED in resolved phase pointing to Next!)
          const needsPunct = /[-'\s]/.test(word.word || '');
          const kbLayout = profile.settings?.keyboard || 'qwerty';
          const guidedTiles = kbLayout === 'guided' ? buildGuidedTiles(word.word) : null;
          const kbPrimaryHandler = phase === 'resolved' ? advanceToNext : handleSubmit;
          const kbPrimaryLabel = phase === 'resolved' ? nextLabel : 'Spell It! ✓';

          if (!keyboard) {
            keyboard = createKeyboard({
              layout: kbLayout,
              beeRules: false,
              submitLabel: kbPrimaryLabel,
              showPunctuation: needsPunct,
              guidedTiles,
              onLetter: (ch) => {
                if (phase !== 'typing') return;
                letters += ch;
                speech.sayLetter(ch);
                updateSlotsOnly();
              },
              onBackspace: () => {
                if (phase !== 'typing' || !letters.length) return;
                letters = letters.slice(0, -1);
                updateSlotsOnly();
              },
              onClear: () => {
                if (phase !== 'typing') return;
                letters = '';
                updateSlotsOnly();
              },
              onRepeat: () => speech.sayWord(session.current()),
              onSubmit: kbPrimaryHandler,
            });
            kbMount.innerHTML = '';
            kbMount.append(keyboard.el);
          } else {
            keyboard.update({
              layout: kbLayout,
              beeRules: false,
              submitLabel: kbPrimaryLabel,
              showPunctuation: needsPunct,
              guidedTiles,
              onSubmit: kbPrimaryHandler,
            });
          }

          keyboard.setDisabled(phase !== 'typing');
          keyboard.setSubmitEnabled(
            !finishing && (phase === 'resolved' || (phase === 'typing' && letters.length > 0))
          );
        };

        const updateSlotsOnly = () => {
          const word = session.current();
          if (!word) return;
          const area = stageMount.querySelector('.slots-area');
          if (area) {
            area.innerHTML = '';
            area.append(
              renderLetterSlots({
                letters,
                targetLength: word.word.length,
                showLength: profile.settings?.showLength !== false,
              })
            );
          }
          if (keyboard) {
            keyboard.setSubmitEnabled(!finishing && phase === 'typing' && letters.length > 0);
          }
        };

        if (!started) renderStartGate();
      };

      boot();
      return cleanup;
    },
  };
}
