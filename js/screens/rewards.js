/**
 * Screen 6: Rewards Shop
 * Dual-track economy per T1 §5 & API.md:
 * 1. Real-world playtime tokens (kid requests cash-in -> parent approves in Parent Area)
 * 2. Coin-only cosmetics shop (world badges & celebration effects; never spends tokens)
 * Fixes: L2 (double-tap cash-in guard + friendly error messages), L7 (dynamic rewardName).
 */

import { getProfile } from '../store/profiles.js';
import {
  buyItem,
  cancelRequest,
  equipItem,
  getRewardSettings,
  getWallet,
  requestCashIn,
} from '../rewards/wallet.js';
import { celebrateBurst, el, friendlyError, showToast } from '../ui/components.js';
import { playThemeCelebration } from '../ui/celebrations.js';
import { applyTheme, COSMETIC_SHOP, getAvatarEmoji } from '../ui/themes.js';

export function RewardsScreen({ router, app }) {
  return {
    mount(rootEl, params) {
      let alive = true;
      let busy = false;
      let activeTab = 'playtime'; // 'playtime' | 'gear'
      const profileId = params?.profileId;
      const section = el('section', { class: 'screen screen--scroll is-active', dataset: { screen: 'rewards' } });
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
        if (app?.setTheme) app.setTheme(profile.theme);
        else applyTheme(profile.theme);

        const [wallet, settings] = await Promise.all([
          getWallet(profile.id).catch(() => ({
            xp: 0,
            level: 1,
            coins: 0,
            tokens: 0,
            minutes: 0,
            rewardName: 'PS5',
            minutesPerToken: 5,
            pending: [],
            earnedToday: 0,
            dailyCap: 6,
            owned: [],
            equipped: {},
          })),
          getRewardSettings().catch(() => ({ rewardName: 'PS5', minutesPerToken: 5, dailyEarnCap: 6 })),
        ]);
        if (!alive) return;

        const minsPerToken = wallet.minutesPerToken || settings.minutesPerToken || 5;
        const rewardName = wallet.rewardName || settings.rewardName || 'PS5';
        wrap.innerHTML = '';

        // Top HUD
        wrap.append(
          el(
            'header',
            { class: 'hud' },
            el(
              'div',
              { class: 'hud-group' },
              el(
                'button',
                { type: 'button', class: 'hud-btn', onClick: () => router.go(`#/home/${encodeURIComponent(profile.id)}`) },
                '◀ Map'
              ),
              el(
                'div',
                { class: 'kid-badge' },
                el('span', { class: 'avatar-circle' }, getAvatarEmoji(profile.avatar)),
                el('div', { class: 'kid-badge__meta' }, el('strong', {}, profile.name), el('span', {}, 'Rewards Shop'))
              )
            ),
            el(
              'div',
              { class: 'hud-group' },
              el('span', { class: 'pill pill--gold' }, `🎮 ${wallet.tokens} tokens (${wallet.minutes} min)`),
              el('span', { class: 'pill' }, `🪙 ${wallet.coins} coins`)
            )
          )
        );

        // Tabs
        wrap.append(
          el(
            'div',
            { class: 'tabs', role: 'tablist' },
            el(
              'button',
              {
                type: 'button',
                class: `tab-btn${activeTab === 'playtime' ? ' is-active' : ''}`,
                onClick: () => {
                  activeTab = 'playtime';
                  render();
                },
              },
              `🎮 ${rewardName} Playtime (${wallet.minutes}m)`
            ),
            el(
              'button',
              {
                type: 'button',
                class: `tab-btn${activeTab === 'gear' ? ' is-active' : ''}`,
                onClick: () => {
                  activeTab = 'gear';
                  render();
                },
              },
              `✨ World Gear & Badges (${wallet.coins} 🪙)`
            )
          )
        );

        if (activeTab === 'playtime') {
          const cashInRow = el('div', { class: 'reward-grid' });
          const presets = [1, 3, 6].map((t) => ({ tokens: t, minutes: t * minsPerToken }));

          for (const preset of presets) {
            const canAfford = (wallet.tokens || 0) >= preset.tokens;
            let btn;
            cashInRow.append(
              el(
                'div',
                { class: 'reward-card' },
                el(
                  'div',
                  { style: 'display:flex;flex-direction:column;gap:6px;' },
                  el('span', { style: 'font-size:34px;' }, '🎮'),
                  el('h3', { class: 'h2' }, `${preset.minutes} min ${rewardName} Pass`),
                  el('p', { class: 'muted', style: 'margin:0;font-size:15px;' }, `Costs ${preset.tokens} reward token${preset.tokens === 1 ? '' : 's'}. A parent approves and adds the time.`)
                ),
                (btn = el(
                  'button',
                  {
                    type: 'button',
                    class: `btn ${canAfford ? 'btn--primary' : 'btn--ghost'} btn--block`,
                    disabled: !canAfford || busy,
                    onClick: async () => {
                      // L2: Guard against double-tap creating two pending cards
                      if (busy) return;
                      busy = true;
                      btn.disabled = true;
                      try {
                        await requestCashIn(profile.id, preset.tokens);
                        celebrateBurst({ style: profile.equipped?.fx || 'default' });
                        showToast(`Requested ${preset.minutes} min! Ask a parent to approve.`, { tone: 'gold' });
                      } catch (err) {
                        showToast(friendlyError(err, 'Could not request cash-in right now.'));
                      } finally {
                        busy = false;
                        if (alive) render();
                      }
                    },
                  },
                  canAfford ? `Cash In ${preset.tokens} Token${preset.tokens === 1 ? '' : 's'}` : `Need ${preset.tokens - (wallet.tokens || 0)} more`
                ))
              )
            );
          }

          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h2', { class: 'h2' }, `You have ${wallet.tokens || 0} token${wallet.tokens === 1 ? '' : 's'} = ${wallet.minutes || 0} ${rewardName} minutes`),
              el(
                'p',
                { class: 'muted', style: 'margin:6px 0 0;font-size:15px;' },
                `1 token = ${minsPerToken} minutes • Earned today: ${wallet.earnedToday || 0} of ${wallet.dailyCap ?? settings.dailyEarnCap ?? 6} daily tokens.`
              )
            ),
            cashInRow
          );

          if (wallet.pending?.length) {
            const pendingList = el('div', { class: 'list-stack' });
            for (const card of wallet.pending) {
              const cardReward = card.reward || rewardName;
              pendingList.append(
                el(
                  'div',
                  { class: 'word-row' },
                  el(
                    'div',
                    { style: 'display:flex;flex-direction:column;gap:4px;' },
                    el('strong', { style: 'font-size:18px;' }, `🎟️ ${card.minutes} ${cardReward} minutes (${card.tokens} token${card.tokens === 1 ? '' : 's'})`),
                    el('span', { class: 'muted', style: 'font-size:14px;' }, 'Waiting for a parent to approve & add playtime')
                  ),
                  el(
                    'div',
                    { style: 'display:flex;gap:8px;' },
                    el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--sm btn--ghost',
                        disabled: busy,
                        onClick: async (e) => {
                          if (busy) return;
                          busy = true;
                          e.currentTarget.disabled = true;
                          try {
                            await cancelRequest(card.id);
                            showToast('Request cancelled — tokens returned!');
                          } catch (err) {
                            showToast(friendlyError(err));
                          } finally {
                            busy = false;
                            if (alive) render();
                          }
                        },
                      },
                      'Undo Request'
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--sm btn--primary',
                        onClick: () => router.go('#/parent'),
                      },
                      '🔒 Parent Approve'
                    )
                  )
                )
              );
            }
            wrap.append(el('div', { class: 'card' }, el('h3', { class: 'h3', style: 'margin-bottom:10px;' }, 'Pending Parent Approval'), pendingList));
          }
        } else {
          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h2', { class: 'h2' }, `World Gear & Trophies — ${wallet.coins || 0} 🪙 Coins`),
              el(
                'p',
                { class: 'muted', style: 'margin:6px 0 0;font-size:15px;' },
                `Coins unlock original badges and celebration effects. Spending coins never touches your ${rewardName} tokens or XP!`
              )
            )
          );

          const ownedSet = new Set(wallet.owned || []);
          const grid = el('div', { class: 'reward-grid' });

          for (const item of COSMETIC_SHOP) {
            const isOwned = ownedSet.has(item.id);
            const isEquipped = wallet.equipped?.[item.slot] === item.id;
            const canAfford = (wallet.coins || 0) >= item.cost;

            grid.append(
              el(
                'div',
                { class: `reward-card${isOwned ? ' is-owned' : ''}` },
                el(
                  'div',
                  { style: 'display:flex;flex-direction:column;gap:6px;' },
                  el('span', { style: 'font-size:36px;' }, item.emoji),
                  el('strong', { style: 'font-size:18px;' }, item.name),
                  el('span', { class: 'muted', style: 'font-size:13px;font-weight:700;' }, `${item.world} • ${item.slot === 'fx' ? 'Celebration FX' : 'Profile Badge'}`)
                ),
                isOwned
                  ? el(
                      'button',
                      {
                        type: 'button',
                        class: `btn ${isEquipped ? 'btn--ghost' : 'btn--primary'} btn--block`,
                        disabled: isEquipped || busy,
                        onClick: async () => {
                          if (busy) return;
                          busy = true;
                          try {
                            const res = await equipItem(profile.id, item.slot, item.id);
                            if (res?.ok) showToast(`Equipped ${item.name}!`);
                            else showToast(friendlyError(res?.reason));
                          } finally {
                            busy = false;
                            if (alive) render();
                          }
                        },
                      },
                      isEquipped ? '✓ Equipped' : 'Equip'
                    )
                  : el(
                      'button',
                      {
                        type: 'button',
                        class: `btn ${canAfford ? 'btn--highlight' : 'btn--ghost'} btn--block`,
                        disabled: !canAfford || busy,
                        onClick: async () => {
                          if (busy) return;
                          busy = true;
                          try {
                            const res = await buyItem(profile.id, item);
                            if (res?.ok) {
                              await equipItem(profile.id, item.slot, item.id);
                              playThemeCelebration({
                                themeId: profile.theme,
                                streak: 3,
                                fxStyle: item.slot === 'fx' ? item.id : 'default',
                                label: `Unlocked ${item.name}!`,
                              });
                              showToast(`Unlocked ${item.name}!`, { tone: 'gold' });
                            } else {
                              showToast(friendlyError(res?.reason, 'Not enough coins yet.'));
                            }
                          } finally {
                            busy = false;
                            if (alive) render();
                          }
                        },
                      },
                      `Unlock • ${item.cost} 🪙`
                    )
              )
            );
          }

          wrap.append(grid);
        }
      };

      const off = app?.events ? app.events.on('wallet:changed', render) : null;
      render();

      return () => {
        alive = false;
        if (off) off();
      };
    },
  };
}
