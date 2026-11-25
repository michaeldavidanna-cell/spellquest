/**
 * Screen 1: Choose a Kid (Profile Picker)
 * - L9: On first launch before any PIN exists, asks a parent to set the PIN first
 *       before any profile is created or opened.
 * - L1: Disables starter-profile creation button while awaiting to prevent duplicates.
 */

import { listProfiles, createProfile, setActiveProfile } from '../store/profiles.js';
import { hasPin, setPin, verifyPin } from '../parent/pin.js';
import { getWallet } from '../rewards/wallet.js';
import { readiness } from '../engine/runner.js';
import { createPinPad, el, friendlyError, showToast } from '../ui/components.js';
import { applyTheme, getAvatarEmoji, getTheme, renderThemeSceneSvg } from '../ui/themes.js';

const MODE_LABELS = {
  competition: 'On Stage • 5th Grade Bee',
  practice: 'Practice Explorer',
  phonics: 'Phonics Mini-Mode',
};

function isStandalonePwa() {
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

export function KidPicker({ router, app }) {
  return {
    mount(rootEl) {
      let alive = true;
      let creatingStarters = false;
      const section = el('section', { class: 'screen screen--scroll is-active', dataset: { screen: 'profiles' } });
      const wrap = el('div', { class: 'page-wrap' });
      section.append(wrap);
      rootEl.innerHTML = '';
      rootEl.append(section);

      const renderFirstLaunchPinSetup = () => {
        wrap.innerHTML = '';
        wrap.append(
          el(
            'header',
            { class: 'profiles-header' },
            el(
              'div',
              { class: 'brand-lockup' },
              el('img', {
                class: 'brand-emblem',
                src: './icons/icon-192.png',
                alt: 'SpellQuest',
                width: 52,
                height: 52,
              }),
              el(
                'div',
                {},
                el('h1', { class: 'h1' }, 'Welcome to SpellQuest'),
                el('p', { class: 'muted', style: 'margin:2px 0 0;font-weight:600;' }, 'Parent First-Time Setup')
              )
            )
          )
        );

        let firstPin = null;
        const pad = createPinPad({
          title: 'Set Your Parent PIN First',
          subtitle: 'Before handing the iPad to the kids, pick a 4–6 digit PIN for playtime approvals & settings.',
          submitLabel: 'Next',
          onSubmit: async (entered) => {
            if (!firstPin) {
              firstPin = entered;
              pad.reset();
              pad.el.querySelector('h2').textContent = 'Confirm Parent PIN';
              pad.el.querySelector('p').textContent = 'Enter the same PIN once more to lock it in.';
              return;
            }
            if (entered !== firstPin) {
              firstPin = null;
              pad.el.querySelector('h2').textContent = 'Set Your Parent PIN First';
              pad.el.querySelector('p').textContent = 'Choose a 4–6 digit PIN.';
              return { error: 'PINs did not match — please try again.' };
            }
            const res = await setPin(entered);
            if (!res?.ok) return { error: friendlyError(res?.reason, 'Could not save PIN.') };
            await verifyPin(entered);
            showToast('Parent PIN set! Ready to choose or create kid profiles.', { tone: 'gold' });
            render();
          },
        });

        wrap.append(
          pad.el,
          el(
            'p',
            { class: 'muted', style: 'text-align:center;font-size:13px;max-width:440px;margin:0 auto;' },
            'Your PIN is stored as a salted PBKDF2-SHA256 hash on this iPad only. It keeps casual hands out of parent approvals and settings.'
          )
        );
      };

      const render = async () => {
        const pinExists = await hasPin();
        if (!alive) return;
        // L9: Require parent PIN setup on first launch before any profile is used
        if (!pinExists) {
          renderFirstLaunchPinSetup();
          return;
        }

        const profiles = await listProfiles();
        if (!alive) return;

        const cardsData = await Promise.all(
          profiles.map(async (p) => {
            const [wallet, ready] = await Promise.all([
              getWallet(p.id).catch(() => ({ xp: 0, level: 1, coins: 0, tokens: 0, minutes: 0, pending: [] })),
              readiness(p.id).catch(() => ({ total: 0, mastered: 0, fixit: 0, pct: 0 })),
            ]);
            return { profile: p, wallet, ready };
          })
        );
        if (!alive) return;

        wrap.innerHTML = '';

        wrap.append(
          el(
            'header',
            { class: 'profiles-header' },
            el(
              'div',
              { class: 'brand-lockup' },
              el('img', {
                class: 'brand-emblem',
                src: './icons/icon-192.png',
                alt: 'SpellQuest',
                width: 52,
                height: 52,
              }),
              el(
                'div',
                {},
                el('h1', { class: 'h1' }, 'SpellQuest'),
                el('p', { class: 'muted', style: 'margin:2px 0 0;font-weight:600;' }, 'Tap your name to start spelling!')
              )
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'hud-btn',
                onClick: () => router.go('#/parent'),
              },
              '🔒 Parent'
            )
          )
        );

        if (!isStandalonePwa()) {
          wrap.append(
            el(
              'div',
              { class: 'install-nudge' },
              el(
                'span',
                {},
                '📱 iPad Tip: For offline study & safe progress, tap Safari Share → Add to Home Screen (keep "Open as Web App" on).'
              )
            )
          );
        }

        if (cardsData.length === 0) {
          let starterBtn;
          wrap.append(
            el(
              'div',
              { class: 'card', style: 'text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;padding:30px 22px;' },
              el('div', { style: 'font-size:52px;' }, '🐝'),
              el('h2', { class: 'h2' }, 'Add Your Kids to Begin!'),
              el(
                'p',
                { class: 'muted', style: 'max-width:520px;margin:0;font-size:17px;line-height:1.45;' },
                'Create starter profiles for your kids in one tap, or open the Parent Area to customize names and word lists.'
              ),
              el(
                'div',
                { style: 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:6px;' },
                (starterBtn = el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    disabled: creatingStarters,
                    onClick: async () => {
                      // L1: Guard against double-tap creating 6 profiles
                      if (creatingStarters) return;
                      creatingStarters = true;
                      starterBtn.disabled = true;
                      starterBtn.textContent = 'Creating profiles…';
                      try {
                        await createProfile({
                          name: '5th Grader',
                          mode: 'competition',
                          avatar: 'trout',
                          theme: 'pinehook',
                        });
                        await createProfile({
                          name: '3rd Grader',
                          mode: 'practice',
                          avatar: 'bike',
                          theme: 'ridgecrest',
                        });
                        await createProfile({
                          name: 'Little Explorer',
                          mode: 'phonics',
                          avatar: 'owl',
                          theme: 'starquill',
                        });
                        showToast('Starter profiles ready! Rename anytime in Parent.', { tone: 'gold' });
                      } catch (err) {
                        showToast(friendlyError(err, 'Could not create starter profiles.'));
                      } finally {
                        creatingStarters = false;
                        if (alive) render();
                      }
                    },
                  },
                  '✨ Create 3 Starter Kid Profiles'
                )),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--lg',
                    onClick: () => router.go('#/parent'),
                  },
                  '🔒 Parent Setup'
                )
              )
            )
          );
          return;
        }

        const grid = el('div', { class: 'profiles-grid' });
        for (const { profile, wallet, ready } of cardsData) {
          const theme = getTheme(profile.theme);
          const card = el(
            'button',
            {
              type: 'button',
              class: 'profile-card',
              onClick: () => {
                setActiveProfile(profile.id);
                if (app?.setTheme) app.setTheme(profile.theme);
                else applyTheme(profile.theme);
                router.go(`#/home/${encodeURIComponent(profile.id)}`);
              },
            },
            el('div', { class: 'avatar-circle avatar-circle--lg' }, getAvatarEmoji(profile.avatar)),
            el('h2', { class: 'profile-card__name' }, profile.name),
            el('div', { class: 'profile-card__mode' }, MODE_LABELS[profile.mode] || 'Speller'),
            el(
              'div',
              { class: 'profile-card__banner', html: renderThemeSceneSvg(theme.id, { compact: true }) }
            ),
            el(
              'div',
              { class: 'profile-card__stats' },
              el('span', { class: 'pill' }, `Lv ${wallet.level || 1}`),
              el('span', { class: 'pill pill--gold' }, `🎮 ${wallet.minutes || 0}m`),
              profile.mode !== 'phonics' && ready.total > 0
                ? el('span', { class: 'pill pill--success' }, `${Math.round((ready.pct || 0) * 100)}% ready`)
                : null,
              ready.fixit > 0 ? el('span', { class: 'pill pill--warn' }, `${ready.fixit} Fix-It`) : null
            )
          );
          grid.append(card);
        }
        wrap.append(grid);
      };

      const off = app?.events ? app.events.on('profiles:changed', render) : null;
      render();

      return () => {
        alive = false;
        if (off) off();
      };
    },
  };
}
