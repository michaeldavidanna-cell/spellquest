/**
 * Original Celebration System for SpellQuest (bee-ui, Task G1)
 * - Per-theme inline SVG animated moments (< 1.5s, 60fps transform/opacity only):
 *     * pinehook   : Fish leaps in an arc, splashes droplets, gets reeled in
 *     * ridgecrest : Mountain biker launches off a jump with dust & sticks landing
 *     * starquill  : Floating hall lanterns ignite & sparkles trace an original rune
 *     * skydrop    : Cloud Glider swoops through sky rings & a Sky Beacon flares
 * - Streak combos (3, 5, 10 in a row get progressively bigger visuals & badges)
 * - Level-up golden burst
 * - Session-complete Trophy Showcase with collected per-word themed items
 * - 100% original art, zero external assets, respects prefers-reduced-motion.
 */

import { el } from './components.js';
import { getTheme } from './themes.js';

const REDUCED_MOTION = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Original collectible items awarded per correct word in a session */
export const COLLECTIBLES_BY_THEME = {
  pinehook: [
    { name: 'Sunscale Perch', icon: '🐟', color: '#0f766e' },
    { name: 'Copper Trout', icon: '🐠', color: '#e06d44' },
    { name: 'Silver Walleye', icon: '🎣', color: '#0284c7' },
    { name: 'Golden Sturgeon', icon: '✨', color: '#d9910b' },
    { name: 'Pinehook Pike', icon: '🏆', color: '#15803d' },
  ],
  ridgecrest: [
    { name: 'Pine Berm', icon: '🌲', color: '#2e6b3e' },
    { name: 'Cedar Bridge', icon: '🪵', color: '#b45309' },
    { name: 'Trail Crest', icon: '🚩', color: '#c85a28' },
    { name: 'Boulder Hop', icon: '🚵', color: '#0f766e' },
    { name: 'Eagle Summit', icon: '🏔️', color: '#d49012' },
  ],
  starquill: [
    { name: 'Hall Lantern', icon: '🏮', color: '#e8b84b' },
    { name: 'Glow Rune', icon: '✨', color: '#4ecdc4' },
    { name: 'Star Potion', icon: '🧪', color: '#818cf8' },
    { name: 'Compass Owl', icon: '🦉', color: '#f6c95e' },
    { name: 'Golden Quill', icon: '🪶', color: '#34d399' },
  ],
  skydrop: [
    { name: 'Lift Gust', icon: '💨', color: '#38bdf8' },
    { name: 'Sky Ring', icon: '⭕', color: '#a78bfa' },
    { name: 'Cloud Glider', icon: '🪁', color: '#fbbf24' },
    { name: 'Sky Beacon', icon: '⚡', color: '#34d399' },
    { name: 'Ridge Crest', icon: '🌟', color: '#38bdf8' },
  ],
};

export function getStreakTier(streak = 1) {
  if (streak >= 10) return { tier: 3, badge: `${streak} IN A ROW! LEGENDARY!`, emoji: '👑', duration: 1450, sparks: 38 };
  if (streak >= 5) return { tier: 2, badge: `${streak} IN A ROW! ON FIRE!`, emoji: '⚡', duration: 1350, sparks: 28 };
  if (streak >= 3) return { tier: 1, badge: `${streak} IN A ROW! COMBO!`, emoji: '🔥', duration: 1250, sparks: 20 };
  return { tier: 0, badge: '', emoji: '', duration: 1120, sparks: 12 };
}

/**
 * Original inline SVG animated vignette for each world theme.
 * All CSS keyframes strictly animate `transform` and `opacity` for 60fps on iPad.
 */
function buildThemeMomentSvg(themeId, tier = 0) {
  const isRare = tier >= 2;
  switch (themeId) {
    case 'ridgecrest':
      return `<svg class="cel-svg cel-svg--ridgecrest" viewBox="0 0 260 130" width="260" height="130" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="rcSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c9e6d8"/>
            <stop offset="100%" stop-color="#f4f1ea"/>
          </linearGradient>
        </defs>
        <rect width="260" height="130" rx="22" fill="url(#rcSky)"/>
        <circle cx="218" cy="28" r="14" fill="${isRare ? '#f59e0b' : '#e09f1f'}" opacity="0.9"/>
        <!-- Pine backdrop -->
        <path d="M18 98 L34 62 L50 98 Z M46 98 L58 72 L70 98 Z M198 98 L216 58 L234 98 Z" fill="#2e6b3e" opacity="0.72"/>
        <!-- Dirt jump ramp & landing hill -->
        <path d="M0 108 L46 108 Q82 108 106 82 L114 82 L114 130 L0 130 Z" fill="#b45309"/>
        <path d="M150 96 Q178 96 206 108 L260 108 L260 130 L150 130 Z" fill="#92400e"/>
        <path d="M0 108 L46 108 Q82 108 106 82" stroke="#c85a28" stroke-width="5" stroke-linecap="round"/>
        <!-- Dust puffs behind jump -->
        <g class="cel-dust">
          <circle cx="96" cy="96" r="7" fill="#e7d6be" opacity="0.9"/>
          <circle cx="84" cy="102" r="5.5" fill="#d6c2a5" opacity="0.8"/>
          <circle cx="108" cy="100" r="6" fill="#e7d6be" opacity="0.85"/>
        </g>
        <!-- Landing burst -->
        <g class="cel-land-burst">
          <circle cx="196" cy="104" r="6" fill="#e09f1f"/>
          <circle cx="212" cy="98" r="4.5" fill="#c85a28"/>
          <circle cx="182" cy="99" r="4.5" fill="#e7d6be"/>
        </g>
        <!-- Original Mountain Biker silhouette launching over the gap -->
        <g class="cel-rider">
          <!-- Wheels -->
          <circle cx="114" cy="74" r="11" stroke="#1e2923" stroke-width="3.2" fill="#fffdf9"/>
          <circle cx="146" cy="74" r="11" stroke="#1e2923" stroke-width="3.2" fill="#fffdf9"/>
          <!-- Frame -->
          <path d="M114 74 L128 58 L143 60 L146 74 M128 58 L130 74 L114 74" stroke="${isRare ? '#e09f1f' : '#c85a28'}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Rider torso & helmet -->
          <path d="M124 58 L132 45 L142 52" stroke="#1e2923" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="136" cy="39" r="6.5" fill="#2e6b3e"/>
          <path d="M133 35 Q142 33 144 39 L136 39 Z" fill="#e09f1f"/>
        </g>
      </svg>`;

    case 'starquill':
      return `<svg class="cel-svg cel-svg--starquill" viewBox="0 0 260 130" width="260" height="130" fill="none" aria-hidden="true">
        <rect width="260" height="130" rx="22" fill="#1b1f3b"/>
        <!-- Soft aura behind rune -->
        <circle class="cel-rune-aura" cx="130" cy="68" r="44" fill="${isRare ? '#4ecdc4' : '#e8b84b'}" opacity="0.22"/>
        <!-- Three floating lanterns lighting up -->
        <g class="cel-lantern cel-lantern--1">
          <circle cx="52" cy="54" r="20" fill="#e8b84b" opacity="0.24"/>
          <rect x="43" y="42" width="18" height="24" rx="6" fill="#e8b84b" stroke="#fff6d6" stroke-width="2"/>
          <circle cx="52" cy="54" r="4.5" fill="#fffdf0"/>
        </g>
        <g class="cel-lantern cel-lantern--2">
          <circle cx="208" cy="54" r="20" fill="#4ecdc4" opacity="0.24"/>
          <rect x="199" y="42" width="18" height="24" rx="6" fill="#4ecdc4" stroke="#e0fffc" stroke-width="2"/>
          <circle cx="208" cy="54" r="4.5" fill="#ffffff"/>
        </g>
        <g class="cel-lantern cel-lantern--3">
          <circle cx="130" cy="28" r="17" fill="#f6c95e" opacity="0.28"/>
          <rect x="122" y="18" width="16" height="20" rx="5" fill="#f6c95e" stroke="#fff6d6" stroke-width="2"/>
          <circle cx="130" cy="28" r="3.8" fill="#ffffff"/>
        </g>
        <!-- Original Glowing Starlight Rune sigil -->
        <g class="cel-rune">
          <polygon points="130,38 140,60 164,64 145,79 150,102 130,90 110,102 115,79 96,64 120,60"
            fill="none" stroke="#f6c95e" stroke-width="3.2" stroke-linejoin="round"/>
          <circle cx="130" cy="70" r="11" stroke="#4ecdc4" stroke-width="2.6"/>
          <circle cx="130" cy="70" r="4" fill="#fff8db"/>
        </g>
        <!-- Sparkle stars -->
        <g class="cel-stars">
          <path d="M84 36 L87 43 L94 46 L87 49 L84 56 L81 49 L74 46 L81 43 Z" fill="#f6c95e"/>
          <path d="M178 82 L180 88 L186 90 L180 92 L178 98 L176 92 L170 90 L176 88 Z" fill="#4ecdc4"/>
          <path d="M82 90 L84 95 L89 97 L84 99 L82 104 L80 99 L75 97 L80 95 Z" fill="#fff6d6"/>
        </g>
      </svg>`;

    case 'skydrop':
      return `<svg class="cel-svg cel-svg--skydrop" viewBox="0 0 260 130" width="260" height="130" fill="none" aria-hidden="true">
        <rect width="260" height="130" rx="22" fill="#132038"/>
        <!-- Ridge horizon -->
        <path d="M0 104 Q66 86 130 98 T260 92 L260 130 L0 130 Z" fill="#23375a"/>
        <!-- Sky Beacon vertical flare -->
        <g class="cel-beacon-flare">
          <polygon points="196,98 214,98 232,6 178,6" fill="${isRare ? '#fbbf24' : '#38bdf8'}" opacity="0.34"/>
          <polygon points="201,98 209,98 216,12 194,12" fill="#e0f2fe" opacity="0.65"/>
        </g>
        <!-- Beacon pad -->
        <rect x="193" y="88" width="24" height="14" rx="4" fill="#fbbf24"/>
        <!-- Two glowing Sky Rings -->
        <ellipse class="cel-ring cel-ring--1" cx="96" cy="56" rx="14" ry="26" stroke="#38bdf8" stroke-width="4"/>
        <ellipse class="cel-ring cel-ring--2" cx="158" cy="48" rx="14" ry="26" stroke="#a78bfa" stroke-width="4"/>
        <!-- Original Cloud Glider swooping through the rings -->
        <g class="cel-glider">
          <path d="M58 58 Q90 36 122 58 L90 65 Z" fill="#38bdf8" stroke="#e0f2fe" stroke-width="2"/>
          <path d="M74 60 L90 78 L106 60" stroke="#fbbf24" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <circle cx="90" cy="79" r="5" fill="#f1f5f9"/>
        </g>
      </svg>`;

    case 'pinehook':
    default:
      return `<svg class="cel-svg cel-svg--pinehook" viewBox="0 0 260 130" width="260" height="130" fill="none" aria-hidden="true">
        <rect width="260" height="130" rx="22" fill="#d2ebe7"/>
        <circle cx="218" cy="28" r="14" fill="#f6c95e" opacity="0.9"/>
        <!-- Distant pines -->
        <path d="M18 82 L34 46 L50 82 Z M44 82 L58 54 L72 82 Z" fill="#174f48" opacity="0.8"/>
        <!-- Fishing rod & line from dock -->
        <path d="M12 96 L64 46" stroke="#78350f" stroke-width="4" stroke-linecap="round"/>
        <path class="cel-line" d="M64 46 Q106 54 146 64" stroke="#123033" stroke-width="2" stroke-dasharray="4 3"/>
        <!-- Leaping original freshwater fish -->
        <g class="cel-fish">
          <path d="M116 66 Q142 42 172 62 Q146 82 116 66 Z" fill="${isRare ? '#f59e0b' : '#e06d44'}" stroke="#123033" stroke-width="2.2"/>
          <polygon points="117,66 102,55 104,78" fill="${isRare ? '#fbbf24' : '#f28c5e'}" stroke="#123033" stroke-width="2"/>
          <path d="M138 55 Q148 44 156 54" fill="#0f766e"/>
          <circle cx="158" cy="60" r="2.8" fill="#123033"/>
          <circle cx="159" cy="59" r="1" fill="#ffffff"/>
        </g>
        <!-- Lake water surface -->
        <path d="M0 84 Q42 76 84 84 T168 84 T260 82 L260 130 L0 130 Z" fill="#0f766e"/>
        <!-- Splash droplets & ripple -->
        <g class="cel-splash">
          <ellipse cx="144" cy="88" rx="34" ry="7" stroke="#ffffff" stroke-width="2.5" opacity="0.85"/>
          <circle cx="122" cy="74" r="4.5" fill="#ffffff"/>
          <circle cx="166" cy="72" r="4" fill="#e0f7f5"/>
          <circle cx="144" cy="68" r="3.5" fill="#ffffff"/>
        </g>
      </svg>`;
  }
}

/**
 * Original SVG Trophy illustration per world theme for Session Summary screens.
 */
function renderThemeTrophySvg(themeId) {
  switch (themeId) {
    case 'ridgecrest':
      return `<svg viewBox="0 0 120 120" width="104" height="104" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="var(--gold-soft)" stroke="var(--gold)" stroke-width="4"/>
        <circle cx="60" cy="56" r="28" stroke="var(--accent)" stroke-width="7"/>
        <circle cx="60" cy="56" r="10" fill="var(--highlight)"/>
        <path d="M60 28 L60 84 M32 56 L88 56 M40 36 L80 76 M80 36 L40 76" stroke="var(--gold)" stroke-width="2.4"/>
        <polygon points="44,92 76,92 70,104 50,104" fill="var(--gold)"/>
      </svg>`;
    case 'starquill':
      return `<svg viewBox="0 0 120 120" width="104" height="104" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="var(--gold-soft)" stroke="var(--gold)" stroke-width="4"/>
        <circle cx="60" cy="56" r="26" fill="var(--accent)" opacity="0.22"/>
        <rect x="44" y="34" width="32" height="44" rx="10" fill="var(--accent)" stroke="#fff6d6" stroke-width="3"/>
        <path d="M50 34 L60 22 L70 34" stroke="var(--gold)" stroke-width="3.5" fill="none"/>
        <circle cx="60" cy="56" r="9" fill="#fffdf0"/>
        <rect x="42" y="84" width="36" height="10" rx="5" fill="var(--highlight)"/>
      </svg>`;
    case 'skydrop':
      return `<svg viewBox="0 0 120 120" width="104" height="104" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="var(--gold-soft)" stroke="var(--accent)" stroke-width="4"/>
        <polygon points="60,20 71,44 96,48 78,65 82,90 60,78 38,90 42,65 24,48 49,44"
          fill="var(--gold)" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="60" cy="57" r="9" fill="#ffffff"/>
      </svg>`;
    case 'pinehook':
    default:
      return `<svg viewBox="0 0 120 120" width="104" height="104" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="var(--gold-soft)" stroke="var(--gold)" stroke-width="4"/>
        <path d="M36 58 Q62 32 90 54 Q66 76 36 58 Z" fill="var(--highlight)" stroke="var(--ink)" stroke-width="2.6"/>
        <polygon points="38,58 22,46 24,70" fill="var(--gold)" stroke="var(--ink)" stroke-width="2.2"/>
        <circle cx="76" cy="52" r="3.5" fill="var(--ink)"/>
        <path d="M34 86 Q60 78 86 86" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"/>
      </svg>`;
  }
}

let activeTimer = null;

/**
 * Plays a short (< 1.5s), 60fps per-theme animated celebration with optional
 * streak combo badge (3, 5, 10 in a row) in `#fx-root` (pointer-events: none).
 */
export function playThemeCelebration({ themeId = 'pinehook', streak = 1, fxStyle = 'default', label = '' } = {}) {
  const root = document.getElementById('fx-root');
  if (!root) return;

  if (activeTimer) {
    window.clearTimeout(activeTimer);
    activeTimer = null;
  }
  root.innerHTML = '';

  const combo = getStreakTier(streak);
  const reduced = REDUCED_MOTION();

  const overlay = el('div', {
    class: `cel-overlay cel-tier--${combo.tier}${reduced ? ' cel-reduced' : ''}`,
  });

  if (combo.tier >= 2 && !reduced) {
    overlay.append(el('div', { class: 'cel-rays' }));
  }

  const card = el('div', { class: 'cel-card' });
  if (combo.badge) {
    card.append(el('div', { class: 'cel-combo-pill' }, `${combo.emoji} ${combo.badge}`));
  }
  card.append(el('div', { class: 'cel-stage', html: buildThemeMomentSvg(themeId, combo.tier) }));
  if (label) {
    card.append(el('div', { class: 'cel-caption' }, label));
  }
  overlay.append(card);

  // Radial GPU-composited sparks (skipped under prefers-reduced-motion)
  if (!reduced) {
    const palette =
      fxStyle === 'fx-rainbow-confetti'
        ? ['#f43f5e', '#f59e0b', '#10b981', '#38bdf8', '#a855f7']
        : fxStyle === 'fx-gold-sparks'
          ? ['#fbbf24', '#fde047', '#f59e0b', '#fffbeb']
          : ['#f6c95e', '#4ecdc4', '#e06d44', '#38bdf8', '#ffffff'];

    const sparksWrap = el('div', { class: 'cel-sparks' });
    const count = combo.sparks;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.28 - 0.14);
      const dist = (combo.tier >= 2 ? 130 : 95) + Math.random() * (combo.tier >= 1 ? 130 : 90);
      const spark = el('span', { class: 'fx-spark' });
      spark.style.left = '50%';
      spark.style.top = '44%';
      spark.style.background = palette[i % palette.length];
      spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
      spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
      sparksWrap.append(spark);
    }
    overlay.append(sparksWrap);
  }

  root.append(overlay);
  const ttl = reduced ? 950 : combo.duration;
  activeTimer = window.setTimeout(() => {
    root.innerHTML = '';
    activeTimer = null;
  }, ttl);
}

/**
 * Plays a golden Level-Up burst (~1.45s, 60fps transform/opacity only).
 */
export function playLevelUpBurst({ level = 2, title = '', themeId = 'pinehook' } = {}) {
  const root = document.getElementById('fx-root');
  if (!root) return;
  if (activeTimer) {
    window.clearTimeout(activeTimer);
    activeTimer = null;
  }
  root.innerHTML = '';

  const reduced = REDUCED_MOTION();
  const theme = getTheme(themeId);
  const overlay = el('div', { class: `cel-overlay cel-levelup${reduced ? ' cel-reduced' : ''}` });
  if (!reduced) overlay.append(el('div', { class: 'cel-rays' }));

  const badgeText = title ? title : `Lv ${level}`;
  overlay.append(
    el(
      'div',
      { class: 'cel-card cel-card--levelup' },
      el('div', { class: 'cel-combo-pill' }, '⭐ LEVEL UP! ⭐'),
      el('div', { class: 'cel-level-num', style: title ? 'font-size:34px;' : '' }, badgeText),
      el('div', { class: 'cel-caption' }, `New rank in ${theme.name}!`)
    )
  );

  if (!reduced) {
    const sparksWrap = el('div', { class: 'cel-sparks' });
    const gold = ['#fbbf24', '#fde047', '#f59e0b', '#ffffff', '#4ecdc4'];
    for (let i = 0; i < 36; i++) {
      const angle = (Math.PI * 2 * i) / 36;
      const dist = 120 + Math.random() * 140;
      const spark = el('span', { class: 'fx-spark' });
      spark.style.left = '50%';
      spark.style.top = '44%';
      spark.style.background = gold[i % gold.length];
      spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
      spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
      sparksWrap.append(spark);
    }
    overlay.append(sparksWrap);
  }

  root.append(overlay);
  activeTimer = window.setTimeout(() => {
    root.innerHTML = '';
    activeTimer = null;
  }, reduced ? 1000 : 1480);
}

/**
 * Generates deterministic original collectibles earned for each correct word in a round.
 */
export function buildCollectedItems(themeId, count = 0) {
  const pool = COLLECTIBLES_BY_THEME[themeId] || COLLECTIBLES_BY_THEME.pinehook;
  const items = [];
  const cap = Math.min(Math.max(0, count), 12);
  for (let i = 0; i < cap; i++) {
    items.push(pool[i % pool.length]);
  }
  return items;
}

/**
 * Renders the Session-Complete Trophy Screen card with animated SVG trophy,
 * collected themed items shelf, streak/accuracy pills, and optional Level-Up banner.
 */
export function renderTrophySummaryCard({
  themeId = 'pinehook',
  title,
  subtitle,
  summary,
  rewardName = 'PS5',
  bestStreak = 0,
  leveledUp = false,
  newLevel = null,
  stageStyle = false,
  actions = [],
}) {
  const theme = getTheme(themeId);
  const collected = buildCollectedItems(themeId, summary?.correct || 0);
  const finalRewardName = summary?.rewardName || rewardName || 'PS5';

  const shelf =
    collected.length > 0
      ? el(
          'div',
          { class: 'trophy-shelf' },
          el('div', { class: 'trophy-shelf__label' }, `Collected this round (${collected.length})`),
          el(
            'div',
            { class: 'trophy-shelf__items' },
            ...collected.map((item, i) => {
              const chip = el(
                'div',
                { class: 'collectible-chip' },
                el('span', { class: 'collectible-chip__icon', 'aria-hidden': 'true' }, item.icon),
                el('span', { class: 'collectible-chip__name' }, item.name)
              );
              chip.style.setProperty('--stagger', `${Math.min(i * 55, 420)}ms`);
              return chip;
            })
          )
        )
      : null;

  return el(
    'div',
    { class: `card trophy-card${stageStyle ? ' card--stage' : ''}` },
    leveledUp && newLevel
      ? el(
          'div',
          { class: 'pill pill--gold trophy-level-banner' },
          typeof newLevel === 'string' ? `⭐ LEVEL UP! Unlocked ${newLevel}!` : `⭐ LEVEL UP! Now Level ${newLevel}!`
        )
      : null,
    el('div', { class: 'trophy-emblem', html: renderThemeTrophySvg(themeId) }),
    el('h1', { class: 'h1' }, title || theme.summaryTitle),
    subtitle ? el('p', { class: 'muted', style: 'margin:0;font-size:18px;font-weight:700;' }, subtitle) : null,
    el(
      'div',
      { style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:10px;' },
      el('span', { class: 'pill pill--accent' }, `+${summary?.xp ?? 0} XP`),
      el('span', { class: 'pill pill--gold' }, `+${summary?.coins ?? 0} 🪙 Coins`),
      bestStreak >= 3 ? el('span', { class: 'pill pill--warn' }, `🔥 Best Streak: ${bestStreak}`) : null,
      summary?.tokens > 0
        ? el(
            'span',
            { class: 'pill pill--success' },
            `+${summary.tokens} token${summary.tokens === 1 ? '' : 's'} (${summary.minutesEarned ?? 0} ${finalRewardName} min!)`
          )
        : summary?.tokenCapped
          ? el('span', { class: 'pill' }, 'Daily token cap reached — XP & coins still earned!')
          : null
    ),
    summary?.newlyMastered?.length
      ? el('div', { class: 'pill pill--success' }, `Mastered: ${summary.newlyMastered.join(', ')}`)
      : null,
    shelf,
    el(
      'div',
      { style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:8px;' },
      ...actions
    )
  );
}
