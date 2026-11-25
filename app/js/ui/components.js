/**
 * Shared UI components, DOM builders, letter slot/diff views, PIN pad,
 * toasts, modals, friendly error messages, and celebration bursts.
 */

import { maskWord } from '../engine/text.js';

const ERROR_MESSAGES = {
  'not-enough-tokens': 'You need more tokens before cashing in this pass.',
  'daily-redeem-cap': 'Daily cash-in limit reached — you can cash in more tomorrow!',
  'not-enough-coins': 'You need a few more coins to unlock that item.',
  'already-owned': 'You already unlocked this item!',
  'not-owned': 'Unlock this item with coins first.',
  'already-resolved': 'This request was already handled.',
  'not-found': 'Could not find that item anymore.',
  'invalid-amount': 'Enter a whole number of tokens (not zero or decimals).',
  'wrong-pin': 'That PIN did not match. Please try again.',
  'pin-required': 'Please enter the Parent PIN first.',
  'parent-locked': 'Parent session timed out — please enter your PIN again.',
  'pin-length': 'PIN must be 4 to 6 digits.',
  locked: 'Too many PIN tries — please wait a few minutes.',
  'bad-backup': 'That file is not a valid SpellQuest backup.',
  'not-a-spellingbee-backup': 'That file is not a SpellQuest backup file.',
  'not-json': 'Could not read that file — please pick a JSON file.',
};

export function friendlyError(codeOrErr, fallback = 'Something went wrong — please try again.') {
  const code = typeof codeOrErr === 'string' ? codeOrErr : codeOrErr?.code || codeOrErr?.reason || codeOrErr?.message;
  if (!code) return fallback;
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  // If it looks like an internal dash-code, use the friendly fallback
  if (/^[a-z0-9-]+$/.test(code)) return fallback;
  return String(code);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function speakerSvg(size = 28) {
  return `<svg viewBox="0 0 36 36" width="${size}" height="${size}" fill="none" aria-hidden="true">
    <path d="M6 14h6l8-6v20l-8-6H6V14Z" fill="currentColor"/>
    <path d="M24 12.5c2 1.8 2 9.2 0 11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M27.8 9.2c3.4 3.6 3.4 14 0 17.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity="0.72"/>
  </svg>`;
}

export function showToast(message, { tone = 'default', duration = 2600 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const toast = el('div', { class: `toast${tone === 'gold' ? ' toast--gold' : ''}` }, message);
  root.append(toast);
  window.setTimeout(() => {
    toast.remove();
  }, duration);
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = '';
  root.hidden = true;
}

export function openModal(contentNode, { dismissible = true } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return () => {};
  root.innerHTML = '';
  const card = el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' }, contentNode);
  root.append(card);
  root.hidden = false;

  const onBackdrop = (ev) => {
    if (dismissible && ev.target === root) closeModal();
  };
  root.onclick = onBackdrop;
  return closeModal;
}

export function celebrateBurst({ style = 'default' } = {}) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.getElementById('fx-root');
  if (!root) return;

  const colors =
    style === 'fx-rainbow-confetti'
      ? ['#f43f5e', '#f59e0b', '#10b981', '#38bdf8', '#a855f7']
      : ['#f6c95e', '#4ecdc4', '#e06d44', '#38bdf8', '#ffffff'];

  const frag = document.createDocumentFragment();
  const count = 22;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.3 - 0.15);
    const dist = 90 + Math.random() * 140;
    const spark = el('span', { class: 'fx-spark' });
    spark.style.left = '50%';
    spark.style.top = '42%';
    spark.style.background = colors[i % colors.length];
    spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
    spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
    frag.append(spark);
  }
  root.append(frag);
  window.setTimeout(() => {
    root.innerHTML = '';
  }, 1050);
}

/**
 * Masks the target word (and stem variants) inside sentences/definitions so
 * on-screen clue captions never spoil the spelling before an attempt.
 * Delegates to engine/text.js maskWord (M4).
 */
export function maskWordInText(text, targetWord) {
  return maskWord(text, targetWord, '______');
}

/**
 * Renders letter slots for Practice (fixed length when showLength=true) or
 * Competition On Stage (dynamic growing strip with no length spoiler).
 */
export function renderLetterSlots({ letters = '', targetLength = 0, showLength = false, marks = null } = {}) {
  const chars = Array.from(letters.toUpperCase());
  const total = showLength && targetLength > 0 ? Math.max(targetLength, chars.length) : chars.length + 1;
  const isLong = total >= 11;
  const wrap = el('div', {
    class: `letter-slots${isLong ? ' is-long' : ''}`,
    role: 'region',
    'aria-live': 'polite',
    'aria-label': chars.length ? `Spelled so far: ${chars.join(' ')}` : 'Ready for letters',
  });

  if (marks && marks.length) {
    for (const m of marks) {
      wrap.append(
        el(
          'span',
          { class: `slot filled ${m.ok ? 'is-match' : 'is-slip'}` },
          (m.ch || '').toUpperCase()
        )
      );
    }
    return wrap;
  }

  for (let i = 0; i < total; i++) {
    const ch = chars[i];
    const isCursor = i === chars.length && (!showLength || i < total);
    if (ch) {
      wrap.append(el('span', { class: 'slot filled' }, ch));
    } else if (isCursor) {
      wrap.append(el('span', { class: 'slot active' }, el('span', { class: 'slot-cursor' })));
    } else {
      wrap.append(el('span', { class: 'slot' }));
    }
  }
  return wrap;
}

/**
 * Renders non-punishing letter-by-letter comparison from grade result
 * (`attemptMarks` + `targetMarks`).
 */
export function renderLetterDiff(result) {
  const box = el('div', { class: 'diff-box' });
  const attemptRow = el('div', { class: 'diff-row' }, el('span', { class: 'diff-label' }, 'You spelled:'));
  const attemptMarks = result.attemptMarks || [];
  if (attemptMarks.length === 0) {
    attemptRow.append(el('span', { class: 'muted' }, '(no letters yet)'));
  } else {
    for (const m of attemptMarks) {
      attemptRow.append(
        el('span', { class: `diff-char ${m.ok ? 'diff-char--ok' : 'diff-char--fix'}` }, (m.ch || '').toUpperCase())
      );
    }
  }

  const targetRow = el('div', { class: 'diff-row' }, el('span', { class: 'diff-label' }, 'Spelling:'));
  for (const m of result.targetMarks || []) {
    targetRow.append(
      el('span', { class: `diff-char ${m.ok ? 'diff-char--ok' : 'diff-char--fix'}` }, (m.ch || '').toUpperCase())
    );
  }

  box.append(attemptRow, targetRow);
  return box;
}

export function formatSeconds(sec) {
  const s = Math.max(0, Math.ceil(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

/**
 * Custom 4–6 digit numeric PIN pad (avoids native iOS keyboard).
 */
export function createPinPad({
  title = 'Parent PIN',
  subtitle = 'Enter your 4–6 digit PIN',
  minLength = 4,
  maxLength = 6,
  submitLabel = 'Unlock',
  onSubmit,
  onCancel,
}) {
  let digits = '';
  const root = el('div', { class: 'pin-gate card' });
  const heading = el('h2', { class: 'h2' }, title);
  const sub = el('p', { class: 'muted', style: 'margin:0' }, subtitle);
  const errorLine = el('div', { class: 'pill pill--warn', hidden: true });
  const dotsEl = el('div', { class: 'pin-dots', 'aria-label': 'PIN digits entered' });

  const renderDots = () => {
    dotsEl.innerHTML = '';
    const count = Math.max(minLength, digits.length);
    for (let i = 0; i < Math.min(maxLength, count); i++) {
      dotsEl.append(el('span', { class: `pin-dot${i < digits.length ? ' is-filled' : ''}` }));
    }
    submitBtn.disabled = digits.length < minLength;
  };

  const setError = (msg) => {
    if (!msg) {
      errorLine.hidden = true;
      errorLine.textContent = '';
    } else {
      errorLine.hidden = false;
      errorLine.textContent = msg;
    }
  };

  const pressDigit = (d) => {
    if (digits.length >= maxLength) return;
    digits += d;
    setError('');
    renderDots();
  };

  const backspace = () => {
    digits = digits.slice(0, -1);
    renderDots();
  };

  const pad = el('div', { class: 'pin-pad' });
  for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    pad.append(
      el(
        'button',
        {
          type: 'button',
          class: 'pin-key',
          onPointerdown: (e) => {
            e.preventDefault();
            pressDigit(d);
          },
        },
        d
      )
    );
  }
  pad.append(
    el(
      'button',
      {
        type: 'button',
        class: 'pin-key',
        onClick: () => {
          digits = '';
          renderDots();
        },
      },
      'Clear'
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'pin-key',
        onPointerdown: (e) => {
          e.preventDefault();
          pressDigit('0');
        },
      },
      '0'
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'pin-key',
        'aria-label': 'Backspace',
        onPointerdown: (e) => {
          e.preventDefault();
          backspace();
        },
      },
      '⌫'
    )
  );

  const submitBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary btn--block',
      disabled: true,
      onClick: async () => {
        if (digits.length < minLength) return;
        const val = digits;
        const res = await onSubmit(val);
        if (res && res.error) {
          digits = '';
          renderDots();
          setError(res.error);
        }
      },
    },
    submitLabel
  );

  const actions = el('div', { style: 'width:100%;display:flex;gap:10px;' });
  if (onCancel) {
    actions.append(el('button', { type: 'button', class: 'btn btn--ghost', onClick: onCancel }, 'Cancel'));
  }
  actions.append(submitBtn);

  root.append(heading, sub, errorLine, dotsEl, pad, actions);
  renderDots();

  return {
    el: root,
    setError,
    reset() {
      digits = '';
      setError('');
      renderDots();
    },
  };
}

/**
 * Renders the standard top HUD bar for gameplay and hub screens.
 */
export function renderPlayHud({
  backLabel = 'Map',
  onBack,
  avatar = '🐝',
  profileName = '',
  modeLabel = '',
  currentIndex = 0,
  total = 0,
  results = [],
  timerEl = null,
  rightExtra = null,
}) {
  const left = el(
    'div',
    { class: 'hud-group' },
    el('button', { type: 'button', class: 'hud-btn', onClick: onBack }, '◀ ', backLabel),
    el(
      'div',
      { class: 'kid-badge' },
      el('span', { class: 'avatar-circle', 'aria-hidden': 'true' }, avatar),
      el(
        'div',
        { class: 'kid-badge__meta' },
        el('strong', {}, profileName),
        el('span', {}, modeLabel)
      )
    )
  );

  const center = el('div', { class: 'progress-track hud-hide-sm' });
  if (total > 0) {
    const dots = el('div', { class: 'progress-dots' });
    const shownTotal = Math.min(total, 15);
    for (let i = 0; i < shownTotal; i++) {
      let cls = 'progress-dot';
      if (i < currentIndex) cls += results[i] === false ? ' missed' : ' done';
      else if (i === currentIndex) cls += ' current';
      dots.append(el('span', { class: cls }));
    }
    center.append(dots, el('span', { class: 'progress-label' }, `Word ${Math.min(currentIndex + 1, total)} of ${total}`));
  }

  const right = el('div', { class: 'hud-group' }, timerEl, rightExtra);
  return el('header', { class: 'hud' }, left, center, right);
}
