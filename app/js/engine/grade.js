// Pure spelling grader (T2 §4: hyphens, spaces, capitals and accents are not required).

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const ENDINGS = ['ible', 'able', 'tion', 'sion', 'cian', 'ance', 'ence', 'ant', 'ent',
  'ious', 'eous', 'ous', 'ary', 'ery', 'ory', 'ful', 'ly', 'er', 'or', 'ar'];

/** Letters only, lowercase, accents removed. */
export function normalizeLetters(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Optimal string alignment (Levenshtein + adjacent swap) with backtrace. */
export function align(target, attempt) {
  const n = target.length;
  const m = attempt.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = target[i - 1] === attempt[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && target[i - 1] === attempt[j - 2] && target[i - 2] === attempt[j - 1]
          && target[i - 1] !== target[i - 2]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && target[i - 1] === attempt[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ op: 'match', t: i - 1, a: j - 1 }); i--; j--;
    } else if (i > 1 && j > 1 && target[i - 1] === attempt[j - 2] && target[i - 2] === attempt[j - 1]
        && target[i - 1] !== target[i - 2] && d[i][j] === d[i - 2][j - 2] + 1) {
      ops.push({ op: 'swap', t: i - 2, a: j - 2 }); i -= 2; j -= 2;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: 'sub', t: i - 1, a: j - 1 }); i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'del', t: i - 1, a: j }); i--;
    } else {
      ops.push({ op: 'ins', t: i, a: j - 1 }); j--;
    }
  }
  ops.reverse();
  return { distance: d[n][m], ops };
}

function isSilentAt(t, i) {
  const c = t[i];
  const prev = t[i - 1];
  const nx = t[i + 1];
  return (c === 'k' && nx === 'n') || (c === 'w' && nx === 'r') || (c === 'g' && nx === 'n')
    || (c === 'b' && prev === 'm') || (c === 'h' && 'grwc'.includes(prev ?? '#'))
    || (c === 'g' && nx === 'h') || (c === 'e' && i === t.length - 1 && t.length > 3)
    || (c === 'p' && nx === 's' && i === 0) || (c === 't' && prev === 's' && nx === 'l')
    || (c === 'n' && prev === 'm' && i === t.length - 1) || (c === 'u' && prev === 'g');
}

function detectPatterns(t, a, ops) {
  const out = new Set();
  for (const o of ops) {
    if (o.op === 'swap') {
      const pair = t.slice(o.t, o.t + 2);
      out.add(pair === 'ie' || pair === 'ei' ? 'ie-ei' : 'swap');
    } else if (o.op === 'del') {
      if ((t[o.t] === t[o.t - 1] || t[o.t] === t[o.t + 1]) && !VOWELS.has(t[o.t])) out.add('double-letter');
      else if (isSilentAt(t, o.t)) out.add('silent-letter');
    } else if (o.op === 'ins') {
      const ch = a[o.a];
      if ((ch === a[o.a - 1] || ch === a[o.a + 1]) && !VOWELS.has(ch)) out.add('double-letter');
    } else if (o.op === 'sub') {
      if (VOWELS.has(t[o.t]) && VOWELS.has(a[o.a])) out.add('vowel');
    }
  }
  const ending = ENDINGS.find((e) => t.endsWith(e));
  if (ending) {
    const cut = t.length - ending.length;
    const wrongOps = ops.filter((o) => o.op !== 'match');
    if (wrongOps.length && wrongOps.every((o) => o.t >= cut - 1)) out.add('ending');
  }
  return [...out];
}

/**
 * Grade an attempt against a word record ({word, accept[]}).
 * @returns {{correct, target, attemptMarks, targetMarks, firstWrongIndex, lettersRightFromStart, patterns, distance}}
 */
export function grade(attempt, word) {
  const display = String(word?.word ?? '');
  const forms = [display, ...(word?.accept ?? [])].map(normalizeLetters).filter(Boolean);
  const a = normalizeLetters(attempt);
  const t = normalizeLetters(display);
  const correct = a.length > 0 && forms.includes(a);

  const { ops, distance } = correct ? align(a, a) : align(t, a);
  const tOk = new Array(t.length).fill(correct);
  const aOk = new Array(a.length).fill(correct);
  if (!correct) {
    for (const o of ops) if (o.op === 'match') { tOk[o.t] = true; aOk[o.a] = true; }
  }

  // Map normalized target letters back onto the display string (keep hyphens/spaces as separators).
  const targetMarks = [];
  let li = 0;
  for (const ch of display) {
    const norm = normalizeLetters(ch);
    if (!norm) { targetMarks.push({ ch, ok: true, sep: true }); continue; }
    targetMarks.push({ ch, ok: correct ? true : !!tOk[li] });
    li += norm.length;
  }
  const attemptMarks = [...a].map((ch, i) => ({ ch, ok: aOk[i] }));

  let prefix = 0;
  while (prefix < a.length && prefix < t.length && a[prefix] === t[prefix]) prefix++;

  return {
    correct,
    target: display,
    attemptMarks,
    targetMarks,
    firstWrongIndex: correct ? -1 : prefix,
    lettersRightFromStart: correct ? t.length : prefix,
    patterns: correct ? [] : detectPatterns(t, a, ops),
    distance: correct ? 0 : distance,
  };
}
