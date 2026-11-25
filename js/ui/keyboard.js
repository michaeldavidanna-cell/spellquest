/**
 * Custom on-screen touch keyboard for iPadOS Safari.
 * Never uses a native <input>, preventing iOS keyboard popups, autocorrect,
 * spellcheck spoilers, and Safari viewport resize jumps.
 *
 * Touch & speech safety (M3):
 * - Visual press feedback happens immediately on `pointerdown`.
 * - Letter/action callbacks fire on `click` (a guaranteed WebKit user-activation
 *   gesture so speech never fails silently on first tap).
 */

import { el } from './components.js';

const QWERTY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const ABC_ROWS = [
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
  ['j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r'],
  ['s', 't', 'u', 'v', 'w', 'x', 'y', 'z'],
];

let audioCtx = null;
function playSoftTap() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(280, audioCtx.currentTime + 0.035);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.045);
  } catch {
    // Ignore audio errors on restricted devices
  }
}

export function createKeyboard({
  layout = 'qwerty',
  beeRules = false,
  submitLabel = 'Spell It! ✓',
  showPunctuation = false,
  guidedTiles = null,
  onLetter = () => {},
  onBackspace = () => {},
  onClear = () => {},
  onRepeat = () => {},
  onSubmit = () => {},
} = {}) {
  const dock = el('section', {
    class: 'keyboard-dock',
    'aria-label': 'On-screen spelling keyboard',
  });

  let lettersDisabled = false;
  let submitEnabled = false;
  let submitHandler = onSubmit;
  let submitBtn = null;
  let clearBtn = null;
  let backBtn = null;

  const triggerLetter = (ch) => {
    if (lettersDisabled) return;
    playSoftTap();
    onLetter(ch);
  };

  const makeLetterKey = (ch, extraClass = '') => {
    const btn = el(
      'button',
      {
        type: 'button',
        class: `kb-key ${extraClass}`.trim(),
        dataset: { key: ch },
        'aria-label': ch === ' ' ? 'Space' : ch.toUpperCase(),
        onPointerdown: () => btn.classList.add('is-pressed'),
        onPointerup: () => btn.classList.remove('is-pressed'),
        onPointerleave: () => btn.classList.remove('is-pressed'),
        onPointercancel: () => btn.classList.remove('is-pressed'),
        onClick: () => triggerLetter(ch),
      },
      ch === ' ' ? '␣' : ch.toUpperCase()
    );
    return btn;
  };

  const syncDisabled = () => {
    dock.querySelectorAll('button').forEach((btn) => {
      if (btn === submitBtn) {
        btn.disabled = !submitEnabled;
      } else if (btn === backBtn || btn === clearBtn) {
        btn.disabled = lettersDisabled || beeRules;
      } else if (btn.dataset.role === 'repeat') {
        btn.disabled = false;
      } else {
        btn.disabled = lettersDisabled;
      }
    });
  };

  const render = (opts = {}) => {
    layout = opts.layout ?? layout;
    beeRules = opts.beeRules ?? beeRules;
    submitLabel = opts.submitLabel ?? submitLabel;
    showPunctuation = opts.showPunctuation ?? showPunctuation;
    guidedTiles = opts.guidedTiles ?? guidedTiles;
    if (opts.onSubmit) submitHandler = opts.onSubmit;

    dock.innerHTML = '';

    if (layout === 'guided' && Array.isArray(guidedTiles) && guidedTiles.length) {
      const bank = el('div', { class: 'tile-bank' });
      guidedTiles.forEach((ch, idx) => {
        const tile = el(
          'button',
          {
            type: 'button',
            class: 'bank-tile',
            dataset: { tileIdx: idx, key: ch },
            onClick: () => triggerLetter(ch),
          },
          ch.toUpperCase()
        );
        bank.append(tile);
      });
      dock.append(bank);
    } else {
      const rows = layout === 'abc' ? ABC_ROWS : QWERTY_ROWS;

      rows.forEach((letters, rowIdx) => {
        const indentClass =
          layout === 'qwerty'
            ? rowIdx === 1
              ? 'kb-row--indent-sm'
              : rowIdx === 2
                ? 'kb-row--indent-md'
                : ''
            : '';
        const rowEl = el('div', { class: `kb-row ${indentClass}`.trim() });
        for (const ch of letters) {
          rowEl.append(makeLetterKey(ch));
        }
        if (rowIdx === 2) {
          backBtn = el(
            'button',
            {
              type: 'button',
              class: 'kb-key kb-key--wide',
              disabled: beeRules || lettersDisabled,
              'aria-label': beeRules ? 'Backspace disabled in Bee Rules' : 'Backspace',
              title: beeRules ? 'Bee Rules: no backspace' : 'Backspace',
              onPointerdown: () => backBtn.classList.add('is-pressed'),
              onPointerup: () => backBtn.classList.remove('is-pressed'),
              onPointerleave: () => backBtn.classList.remove('is-pressed'),
              onPointercancel: () => backBtn.classList.remove('is-pressed'),
              onClick: () => {
                if (lettersDisabled || beeRules) return;
                playSoftTap();
                onBackspace();
              },
            },
            '⌫'
          );
          rowEl.append(backBtn);
        }
        dock.append(rowEl);
      });
    }

    // Action row (Clear, optional punctuation, Hear Again, Submit / Next)
    const actionRow = el('div', { class: 'kb-row' });

    clearBtn = el(
      'button',
      {
        type: 'button',
        class: 'kb-key kb-key--util',
        disabled: beeRules || lettersDisabled,
        onClick: () => {
          if (lettersDisabled || beeRules) return;
          playSoftTap();
          onClear();
        },
      },
      'Clear'
    );
    actionRow.append(clearBtn);

    if (showPunctuation) {
      actionRow.append(
        makeLetterKey('-', 'kb-key--punct'),
        makeLetterKey("'", 'kb-key--punct'),
        makeLetterKey(' ', 'kb-key--punct')
      );
    }

    const repeatBtn = el(
      'button',
      {
        type: 'button',
        class: 'kb-key kb-key--util',
        dataset: { role: 'repeat' },
        onClick: () => onRepeat(),
      },
      '🔊 Again'
    );
    actionRow.append(repeatBtn);

    submitBtn = el(
      'button',
      {
        type: 'button',
        class: 'kb-key kb-key--submit',
        disabled: !submitEnabled,
        onClick: () => {
          if (!submitEnabled) return;
          submitHandler();
        },
      },
      submitLabel
    );
    actionRow.append(submitBtn);

    dock.append(actionRow);
    syncDisabled();
  };

  // Optional physical keyboard support (Magic Keyboard on iPad) — never focuses an <input>
  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Enter') {
      if (submitEnabled) {
        e.preventDefault();
        submitHandler();
      }
      return;
    }
    if (lettersDisabled) return;

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      triggerLetter(e.key.toLowerCase());
    } else if (showPunctuation && (e.key === '-' || e.key === "'" || e.key === ' ')) {
      e.preventDefault();
      triggerLetter(e.key);
    } else if (e.key === 'Backspace') {
      if (!beeRules) {
        e.preventDefault();
        onBackspace();
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);
  render();

  return {
    el: dock,
    update(opts) {
      render(opts);
    },
    setSubmitEnabled(canSubmit) {
      submitEnabled = Boolean(canSubmit);
      if (submitBtn) submitBtn.disabled = !submitEnabled;
    },
    setDisabled(isDisabled) {
      lettersDisabled = Boolean(isDisabled);
      syncDisabled();
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
