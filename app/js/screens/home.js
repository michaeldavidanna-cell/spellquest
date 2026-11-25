/**
 * Screen 2: Home / World Map
 * Per-kid world banner, daily progress, mode-tailored action tiles, and original theme switcher.
 */

import { getProfile, setActiveProfile, updateProfile } from '../store/profiles.js';
import { wordsForProfile } from '../store/wordlists.js';
import { getWallet, getRewardSettings } from '../rewards/wallet.js';
import { phonicsLadder, readiness } from '../engine/runner.js';
import { PHONICS_TYPES } from '../engine/phonics.js';
import { el, showToast } from '../ui/components.js';
import {
  applyTheme,
  COSMETIC_SHOP,
  getAvatarEmoji,
  getTheme,
  renderThemeSceneSvg,
  THEME_LIST,
} from '../ui/themes.js';

export function Home({ router, app }) {
  return {
    mount(rootEl, params) {
      let alive = true;
      const profileId = params?.profileId;
      const section = el('section', { class: 'screen screen--scroll is-active', dataset: { screen: 'home' } });
      const wrap = el('div', { class: 'page-wrap' });
      section.append(wrap);
      rootEl.innerHTML = '';
      rootEl.append(section);

      const render = async () => {
        const profile = await getProfile(profileId);
        if (!alive) return;
        if (!profile) {
          router.go('#/kids', { replace: true });
          return;
        }

        setActiveProfile(profile.id);
        const theme = app?.setTheme ? (app.setTheme(profile.theme), getTheme(profile.theme)) : applyTheme(profile.theme);

        const [wallet, ready, rewardSettings, ladder] = await Promise.all([
          getWallet(profile.id).catch(() => ({
            xp: 0,
            level: 1,
            levelProgress: 0,
            coins: 0,
            tokens: 0,
            minutes: 0,
            pending: [],
            earnedToday: 0,
            dailyCap: 6,
            owned: [],
            equipped: {},
          })),
          readiness(profile.id).catch(() => ({ total: 0, mastered: 0, seen: 0, fixit: 0, pct: 0 })),
          getRewardSettings().catch(() => ({ rewardName: 'PS5', minutesPerToken: 5, dailyEarnCap: 6 })),
          profile.mode === 'phonics'
            ? phonicsLadder(profile.id, { types: PHONICS_TYPES }).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!alive) return;

        const words = wordsForProfile(profile);
        const equippedBadge = COSMETIC_SHOP.find((i) => i.id === wallet.equipped?.badge);

        wrap.innerHTML = '';

        // Top HUD
        wrap.append(
          el(
            'header',
            { class: 'hud' },
            el(
              'div',
              { class: 'hud-group' },
              el('button', { type: 'button', class: 'hud-btn', onClick: () => router.go('#/kids') }, '◀ Kids'),
              el(
                'div',
                { class: 'kid-badge' },
                el('span', { class: 'avatar-circle' }, getAvatarEmoji(profile.avatar)),
                el(
                  'div',
                  { class: 'kid-badge__meta' },
                  el('strong', {}, profile.name, equippedBadge ? ` ${equippedBadge.emoji}` : ''),
                  el('span', {}, `Level ${wallet.level || 1} • 🔥 ${profile.streak?.count || 0} day streak`)
                )
              )
            ),
            el(
              'div',
              { class: 'hud-group' },
              el(
                'button',
                {
                  type: 'button',
                  class: 'pill pill--gold',
                  style: 'min-height:46px;padding:0 14px;cursor:pointer;',
                  onClick: () => router.go(`#/rewards/${encodeURIComponent(profile.id)}`),
                },
                `🎮 ${wallet.minutes || 0}m • 🪙 ${wallet.coins || 0}`
              ),
              el(
                'button',
                {
                  type: 'button',
                  class: 'hud-btn',
                  'aria-label': 'Parent Area',
                  onClick: () => router.go('#/parent'),
                },
                '🔒'
              )
            )
          )
        );

        // World Hero Banner
        const xpPct = Math.max(4, Math.min(100, Math.round((wallet.levelProgress || 0) * 100)));
        const readyPct = ready.total > 0 ? Math.round((ready.pct || 0) * 100) : 0;

        wrap.append(
          el(
            'div',
            { class: 'card world-hero' },
            el('div', { class: 'world-hero__scene', html: renderThemeSceneSvg(theme.id) }),
            el(
              'div',
              { class: 'world-hero__info' },
              el('span', { class: 'pill' }, theme.name),
              el('h1', { class: 'h1' }, `Welcome back, ${profile.name}!`),
              el('p', { class: 'muted', style: 'margin:0;font-size:16px;' }, theme.tagline),
              profile.mode !== 'phonics'
                ? el(
                    'div',
                    { style: 'display:flex;flex-direction:column;gap:6px;' },
                    el(
                      'div',
                      { style: 'display:flex;justify-content:space-between;font-size:14px;font-weight:700;' },
                      el('span', {}, theme.heroProgress(readyPct)),
                      el('span', {}, `${ready.mastered}/${ready.total} mastered`)
                    ),
                    el('div', { class: 'meter' }, el('div', { class: 'meter__fill', style: `width:${Math.max(4, readyPct)}%` }))
                  )
                : el(
                    'div',
                    { style: 'display:flex;flex-direction:column;gap:6px;' },
                    el(
                      'div',
                      { style: 'display:flex;justify-content:space-between;font-size:14px;font-weight:700;' },
                      el('span', {}, `Level ${wallet.level || 1} Explorer`),
                      el('span', {}, `${wallet.xp || 0} XP`)
                    ),
                    el('div', { class: 'meter' }, el('div', { class: 'meter__fill', style: `width:${xpPct}%` }))
                  ),
              el(
                'div',
                { style: 'display:flex;flex-wrap:wrap;gap:8px;' },
                el(
                  'span',
                  { class: 'pill pill--gold' },
                  `Today: ${wallet.earnedToday || 0}/${wallet.dailyCap ?? rewardSettings.dailyEarnCap ?? 6} tokens`
                ),
                wallet.pending?.length
                  ? el('span', { class: 'pill pill--accent' }, `${wallet.pending.length} pending parent approval`)
                  : null
              )
            )
          )
        );

        // Primary Mode Action Grid
        const actions = el('div', { class: 'home-actions' });

        if (profile.mode === 'phonics') {
          actions.append(
            el(
              'button',
              {
                type: 'button',
                class: 'action-tile action-tile--hero',
                onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/phonics`),
              },
              el('span', { class: 'action-tile__icon' }, '🎈'),
              el('div', {}, el('div', { class: 'action-tile__title' }, 'Play Letter Adventure!'), el('div', { class: 'action-tile__sub muted' }, 'Tap sounds, match pictures, and build fun 3-letter words.'))
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'action-tile',
                onClick: () => router.go(`#/rewards/${encodeURIComponent(profile.id)}`),
              },
              el('span', { class: 'action-tile__icon' }, '🏆'),
              el(
                'div',
                {},
                el('div', { class: 'action-tile__title' }, 'Rewards & Trophies'),
                el('div', { class: 'action-tile__sub muted' }, `${wallet.minutes || 0} min earned • ${wallet.coins || 0} coins`)
              )
            )
          );
        } else {
          const isComp = profile.mode === 'competition';

          const stageTile = el(
            'button',
            {
              type: 'button',
              class: `action-tile${isComp ? ' action-tile--hero' : ''}`,
              onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/stage`),
            },
            el('span', { class: 'action-tile__icon' }, '🎤'),
            el(
              'div',
              {},
              el('div', { class: 'action-tile__title' }, isComp ? 'On Stage (Round 2)' : 'On Stage Tryout'),
              el(
                'div',
                { class: 'action-tile__sub muted' },
                words.length
                  ? `Real bee format with 6 official asks (${words.length} words loaded).`
                  : 'Import a word list in Parent Area to begin.'
              )
            )
          );

          const practiceTile = el(
            'button',
            {
              type: 'button',
              class: `action-tile${!isComp ? ' action-tile--hero' : ''}`,
              onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/practice`),
            },
            el('span', { class: 'action-tile__icon' }, '✨'),
            el(
              'div',
              {},
              el('div', { class: 'action-tile__title' }, 'Practice Round'),
              el(
                'div',
                { class: 'action-tile__sub muted' },
                `${profile.settings?.sessionSize || 8} words with friendly retries & syllable hints.`
              )
            )
          );

          const mistakesTile = el(
            'button',
            {
              type: 'button',
              class: 'action-tile',
              onClick: () => router.go(`#/mistakes/${encodeURIComponent(profile.id)}`),
            },
            el('span', { class: 'action-tile__icon' }, ready.fixit > 0 ? '🛠️' : '🌟'),
            el(
              'div',
              {},
              el('div', { class: 'action-tile__title' }, 'Mistake Review'),
              el(
                'div',
                { class: 'action-tile__sub muted' },
                ready.fixit > 0
                  ? `${ready.fixit} tricky word${ready.fixit === 1 ? '' : 's'} ready to tame for bonus XP!`
                  : 'All clear! Every practiced word is on track.'
              )
            )
          );

          const rewardsTile = el(
            'button',
            {
              type: 'button',
              class: 'action-tile',
              onClick: () => router.go(`#/rewards/${encodeURIComponent(profile.id)}`),
            },
            el('span', { class: 'action-tile__icon' }, '🎮'),
            el(
              'div',
              {},
              el('div', { class: 'action-tile__title' }, 'Rewards Shop'),
              el(
                'div',
                { class: 'action-tile__sub muted' },
                `${wallet.tokens || 0} tokens (${wallet.minutes || 0} ${wallet.rewardName || rewardSettings.rewardName || 'PS5'} min) • ${wallet.coins || 0} coins`
              )
            )
          );

          if (isComp) {
            actions.append(stageTile, practiceTile, mistakesTile, rewardsTile);
          } else {
            actions.append(practiceTile, mistakesTile, stageTile, rewardsTile);
          }
        }

        wrap.append(actions);

        // Libby's Phonics Level Ladder map on Home screen (A1 ladder)
        if (profile.mode === 'phonics' && ladder?.levels?.length) {
          const pills = ladder.levels.map((lv) => {
            const isCur = lv.id === ladder.current;
            const cls = lv.mastered ? 'pill pill--success' : isCur ? 'pill pill--gold' : 'pill';
            const statusIcon = lv.mastered ? '✓ ' : isCur ? '▶ ' : '';
            return el(
              'span',
              { class: cls, style: 'padding:8px 14px;font-size:15px;' },
              `${statusIcon}${lv.emoji ? `${lv.emoji} ` : ''}${lv.title} (${lv.known}/${lv.total})`
            );
          });
          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:10px;' }, 'Reading Adventure Ladder'),
              el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;' }, ...pills)
            )
          );
        }

        // Original World Theme Switcher
        const themeStrip = el('div', { class: 'theme-strip' });
        for (const t of THEME_LIST) {
          themeStrip.append(
            el(
              'button',
              {
                type: 'button',
                class: `theme-chip${t.id === theme.id ? ' is-selected' : ''}`,
                onClick: async () => {
                  await updateProfile(profile.id, { theme: t.id });
                  if (app?.setTheme) app.setTheme(t.id);
                  else applyTheme(t.id);
                  showToast(`Switched world to ${t.name}!`);
                  render();
                },
              },
              el('span', { class: 'theme-swatch', style: `background:${t.swatch}` }),
              t.name
            )
          );
        }

        wrap.append(
          el(
            'div',
            { class: 'card' },
            el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;' },
              el('h3', { class: 'h3' }, 'Choose Your Adventure World'),
              el('span', { class: 'muted', style: 'font-size:13px;font-weight:700;' }, 'Switch worlds anytime')
            ),
            themeStrip
          )
        );
      };

      const offs = [];
      if (app?.events) {
        offs.push(app.events.on('wallet:changed', render));
        offs.push(app.events.on('wordlists:changed', render));
      }

      render();

      return () => {
        alive = false;
        offs.forEach((off) => off && off());
      };
    },
  };
}
