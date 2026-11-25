/**
 * Original world themes, SVG illustrations, avatar badges, feedback copy,
 * and coin-only cosmetic shop items.
 * 100% original IP — no third-party franchises, names, art, or external assets.
 */

export const THEMES = {
  pinehook: {
    id: 'pinehook',
    name: 'Pinehook Lake',
    tagline: 'Cast a line & reel in rare freshwater catches',
    swatch: '#0f766e',
    metaColor: '#0f766e',
    unlockLevel: 1,
    kicker: 'Pinehook Lake • Catch Meter',
    milestoneLabel: (done, total) => `Reeling in: Copper Trout (${done}/${total})`,
    heroProgress: (pct) => `${pct}% of the lake explored`,
    praise: [
      'Nice cast! You reeled that word right in!',
      'Clean catch — hooked it on the first try!',
      'Smooth reel! Another keeper for your tackle box!',
      'Steady line! That spelling was spot-on!',
    ],
    retryPrompt: [
      'Ooh, a nibble! Check the golden letters and cast once more.',
      'Line wiggled loose on one letter — give it another cast!',
    ],
    learnPrompt: 'Good cast! Study the spelling below and add it to your Fix-It tackle box.',
    summaryTitle: 'Full Stringer!',
  },
  ridgecrest: {
    id: 'ridgecrest',
    name: 'Ridgecrest Trails',
    tagline: 'Carve pine berms & climb to Eagle Summit',
    swatch: '#2e6b3e',
    metaColor: '#2e6b3e',
    unlockLevel: 1,
    kicker: 'Ridgecrest Trails • Climb Progress',
    milestoneLabel: (done, total) => `Next trail feature: Cedar Bridge (${done}/${total})`,
    heroProgress: (pct) => `${pct}% up Eagle Summit`,
    praise: [
      'Clean line! You flew right over the berm!',
      'Smooth ride — great trail momentum!',
      'Summit power! Nailed that climb!',
      'Awesome cadence — pedals locked in!',
    ],
    retryPrompt: [
      'Quick brake check! Check the highlighted letters and roll it back!',
      'Small root on the trail — check the gold letters and ride again!',
    ],
    learnPrompt: 'Good climb! Check the trail sign below — we will practice this one again.',
    summaryTitle: 'Summit Reached!',
  },
  starquill: {
    id: 'starquill',
    name: 'Starquill Academy',
    tagline: 'Trace glowing runes & light floating hall lanterns',
    swatch: '#e8b84b',
    metaColor: '#181a2e',
    unlockLevel: 1,
    kicker: 'Starquill Academy • Hall Lanterns',
    milestoneLabel: (done, total) => `Lanterns lit in Study Hall (${done}/${total})`,
    heroProgress: (pct) => `${pct}% of the Spellbook illuminated`,
    praise: [
      'Brilliant incantation! Another hall lantern just lit up!',
      'Pure wordcraft — the runes shimmered brightly!',
      'Splendid spell! Your quill glowed gold!',
      'Starlight accuracy! Chapter complete!',
    ],
    retryPrompt: [
      'The rune flickered softly — check the gold letters and cast again!',
      'Almost brewed! Adjust the highlighted letters and give it another spark.',
    ],
    learnPrompt: 'Curious wordcraft! Read the glowing runes below to lock it in.',
    summaryTitle: 'Chapter Illuminated!',
  },
  skydrop: {
    id: 'skydrop',
    name: 'SkyDrop Ridge',
    tagline: 'Ride the Lift Gust, charge Sky Beacons & sail on a Cloud Glider',
    swatch: '#38bdf8',
    metaColor: '#121b2e',
    unlockLevel: 1,
    kicker: 'SkyDrop Ridge • Sky Beacon',
    milestoneLabel: (done, total) => `Sky Beacon (${done}/${total})`,
    heroProgress: (pct) => `${pct}% of Sky Beacons online`,
    praise: [
      'Signal beacon unlocked! Smooth landing!',
      'Sky Beacon charged! Lift Gust rising!',
      'High-altitude spelling — locked in!',
      'Awesome glide! Direct landing on the mark!',
    ],
    retryPrompt: [
      'Lift Gust wobbled — adjust the gold letters and glide back in!',
      'Close landing! Check the highlighted letters and try once more.',
    ],
    learnPrompt: 'Good glide! Check the beacon code below — we saved it for your next run.',
    summaryTitle: 'Cloud Glider Launched!',
  },
};

export const THEME_LIST = Object.values(THEMES);

export const AVATARS = [
  { id: 'trout', emoji: '🐟', label: 'Copper Trout' },
  { id: 'bike', emoji: '🚵', label: 'Trail Rider' },
  { id: 'owl', emoji: '🦉', label: 'Compass Owl' },
  { id: 'glider', emoji: '🪂', label: 'Cloud Glider' },
  { id: 'fox', emoji: '🦊', label: 'Lantern Fox' },
  { id: 'bee', emoji: '🐝', label: 'Honey Bee' },
  { id: 'star', emoji: '🌟', label: 'Star Quill' },
  { id: 'camp', emoji: '⛺', label: 'Base Camp' },
];

export const COSMETIC_SHOP = [
  { id: 'badge-golden-bobber', name: 'Golden Bobber', slot: 'badge', cost: 25, emoji: '🎣', world: 'Pinehook Lake' },
  { id: 'badge-midnight-pike', name: 'Midnight Pike Trophy', slot: 'badge', cost: 40, emoji: '🐟', world: 'Pinehook Lake' },
  { id: 'badge-summit-flag', name: 'Eagle Summit Flag', slot: 'badge', cost: 25, emoji: '🚩', world: 'Ridgecrest Trails' },
  { id: 'badge-trail-helmet', name: 'Alpine Trail Helmet', slot: 'badge', cost: 40, emoji: '⛑️', world: 'Ridgecrest Trails' },
  { id: 'badge-star-lantern', name: 'Floating Hall Lantern', slot: 'badge', cost: 25, emoji: '🏮', world: 'Starquill Academy' },
  { id: 'badge-brass-astrolabe', name: 'Brass Astrolabe', slot: 'badge', cost: 45, emoji: '🧭', world: 'Starquill Academy' },
  { id: 'badge-glider-wing', name: 'Aurora Cloud Glider', slot: 'badge', cost: 30, emoji: '🪁', world: 'SkyDrop Ridge' },
  { id: 'badge-sky-beacon', name: 'Sky Beacon Crest', slot: 'badge', cost: 45, emoji: '⚡', world: 'SkyDrop Ridge' },
  { id: 'fx-gold-sparks', name: 'Gold Sparkle Burst', slot: 'fx', cost: 35, emoji: '✨', world: 'All Worlds' },
  { id: 'fx-rainbow-confetti', name: 'Festival Confetti', slot: 'fx', cost: 50, emoji: '🎉', world: 'All Worlds' },
];

export function getTheme(themeId) {
  return THEMES[themeId] || THEMES.pinehook;
}

export function getAvatarEmoji(avatarId) {
  const found = AVATARS.find((a) => a.id === avatarId || a.emoji === avatarId);
  return found ? found.emoji : '🐝';
}

export function applyTheme(themeId) {
  const theme = getTheme(themeId);
  document.documentElement.dataset.theme = theme.id;
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', theme.metaColor);
  return theme;
}

export function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Original inline SVG world illustration for both the Home hero and compact gameplay strip.
 */
export function renderThemeSceneSvg(themeId, { compact = false } = {}) {
  const w = compact ? 140 : 420;
  const h = compact ? 68 : 180;
  switch (themeId) {
    case 'ridgecrest':
      return `<svg viewBox="0 0 140 68" width="${w}" height="${h}" fill="none" aria-hidden="true">
        <rect width="140" height="68" fill="var(--scene-sky)"/>
        <circle cx="24" cy="18" r="8" fill="var(--gold)" opacity="0.85"/>
        <path d="M0 54 L36 22 L66 46 L98 16 L140 52 L140 68 L0 68 Z" fill="var(--accent)" opacity="0.86"/>
        <path d="M8 68 Q54 46 84 52 T138 38" stroke="var(--highlight)" stroke-width="5" stroke-linecap="round"/>
        <line x1="98" y1="16" x2="98" y2="5" stroke="var(--ink)" stroke-width="2"/>
        <polygon points="98,5 113,9 98,13" fill="var(--gold)"/>
        <circle cx="52" cy="52" r="7" stroke="#FFFDF9" stroke-width="2.2"/>
        <circle cx="72" cy="50" r="7" stroke="#FFFDF9" stroke-width="2.2"/>
        <path d="M52 52 L61 42 L72 50 M61 42 L68 42" stroke="var(--gold)" stroke-width="2.2" stroke-linecap="round"/>
      </svg>`;
    case 'starquill':
      return `<svg viewBox="0 0 140 68" width="${w}" height="${h}" fill="none" aria-hidden="true">
        <rect width="140" height="68" fill="var(--scene-sky)"/>
        <circle cx="22" cy="18" r="2.2" fill="var(--gold)"/>
        <circle cx="116" cy="14" r="2.4" fill="var(--highlight)"/>
        <circle cx="102" cy="28" r="1.6" fill="var(--gold)"/>
        <circle cx="38" cy="30" r="1.5" fill="var(--highlight)"/>
        <circle cx="70" cy="33" r="23" fill="var(--accent)" opacity="0.18"/>
        <rect x="61" y="20" width="18" height="26" rx="6" fill="var(--accent)" stroke="#FFF6D6" stroke-width="1.8"/>
        <path d="M64 20 L70 13 L76 20" stroke="var(--gold)" stroke-width="2" fill="none"/>
        <circle cx="70" cy="33" r="4.5" fill="#FFF8DB"/>
        <path d="M22 57 Q46 49 70 57 Q94 49 118 57" stroke="var(--highlight)" stroke-width="2.6" stroke-linecap="round"/>
      </svg>`;
    case 'skydrop':
      return `<svg viewBox="0 0 140 68" width="${w}" height="${h}" fill="none" aria-hidden="true">
        <rect width="140" height="68" fill="var(--scene-sky)"/>
        <circle cx="118" cy="16" r="1.8" fill="var(--gold)"/>
        <circle cx="18" cy="14" r="1.8" fill="var(--accent)"/>
        <path d="M0 52 Q40 40 78 50 T140 44 L140 68 L0 68 Z" fill="#23375A"/>
        <polygon points="94,50 104,50 112,5 86,5" fill="var(--accent)" opacity="0.22"/>
        <rect x="92" y="42" width="14" height="10" rx="2" fill="var(--gold)"/>
        <path d="M24 24 Q48 9 72 24 L48 28 Z" fill="var(--accent)"/>
        <path d="M39 26 L48 38 L57 26" stroke="#F1F5F9" stroke-width="1.8" fill="none"/>
      </svg>`;
    case 'pinehook':
    default:
      return `<svg viewBox="0 0 140 68" width="${w}" height="${h}" fill="none" aria-hidden="true">
        <rect width="140" height="68" fill="var(--scene-sky)"/>
        <circle cx="114" cy="18" r="10" fill="var(--gold)" opacity="0.88"/>
        <path d="M0 44 Q35 37 70 44 T140 42 L140 68 L0 68 Z" fill="var(--accent)" opacity="0.9"/>
        <path d="M16 44 L28 20 L40 44 Z" fill="#174f48"/>
        <path d="M32 44 L43 25 L54 44 Z" fill="#226e64"/>
        <line x1="78" y1="12" x2="94" y2="41" stroke="#123033" stroke-width="1.6" stroke-dasharray="3 2"/>
        <circle cx="94" cy="43" r="6" fill="#FFFFFF"/>
        <path d="M88 43 A6 6 0 0 1 100 43 Z" fill="var(--highlight)"/>
        <ellipse cx="94" cy="53" rx="16" ry="3.2" stroke="#FFFFFF" stroke-width="1.6" opacity="0.72"/>
      </svg>`;
  }
}
