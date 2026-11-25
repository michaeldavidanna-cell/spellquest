/**
 * Screen 7: Parent Area (PIN-Gated)
 * Fixes from R1 + B1a:
 * - M6 & B1a #8: Listens for `parent:locked`, calls `lockParent()` on exit/cleanup,
 *   and confirms PIN via PIN pad before marking playtime minutes added.
 * - M7: Checks `wl.source === 'import'` so imported lists always show Remove.
 * - L2/L3: Maps all error codes to friendly text, catches setRewardSettings/deleteProfile,
 *   validates integer tokens and checks adjustTokens `{ok, reason}`.
 * - L7: Uses dynamic `rewardName` (editable in settings).
 * - B1a #7: Pre-builds backup via `prepareBackup()` so `shareBackup(prepared)` runs
 *   synchronously inside the tap for iPadOS Safari `navigator.share`.
 */

import { hasPin, lockParent, parentSessionActive, setPin, verifyPin } from '../parent/pin.js';
import {
  createProfile,
  deleteProfile,
  listProfiles,
  updateProfile,
} from '../store/profiles.js';
import {
  getWordLists,
  importWordListFile,
  removeImportedList,
} from '../store/wordlists.js';
import {
  adjustTokens,
  declineCard,
  getRewardSettings,
  listPending,
  markAdded,
  setRewardSettings,
} from '../rewards/wallet.js';
import { ps5Steps } from '../rewards/economy.js';
import { readiness, topMistakes } from '../engine/runner.js';
import { importBackup, lastBackupAt, prepareBackup, shareBackup } from '../store/backup.js';
import { audioStatus, clearAudio, downloadAllAudio } from '../audio/clips.js';
import { speech } from '../audio/speech.js';
import {
  closeModal,
  createPinPad,
  el,
  friendlyError,
  openModal,
  showToast,
} from '../ui/components.js';
import { AVATARS, getAvatarEmoji, THEME_LIST } from '../ui/themes.js';

export function ParentScreen({ router, app }) {
  return {
    mount(rootEl) {
      let alive = true;
      let unlockedPin = null;
      let activeTab = 'approvals'; // 'approvals' | 'kids' | 'lists' | 'progress' | 'system'
      let preparedBackup = null;
      let audioAbort = null;

      const section = el('section', { class: 'screen screen--scroll is-active', dataset: { screen: 'parent' } });
      const wrap = el('div', { class: 'page-wrap' });
      section.append(wrap);
      rootEl.innerHTML = '';
      rootEl.append(section);

      const handleLocked = (reason) => {
        if (!alive) return;
        const wasUnlocked = Boolean(unlockedPin);
        unlockedPin = null;
        closeModal();
        if (wasUnlocked) {
          showToast(
            reason === 'idle'
              ? 'Parent Area locked after 2 minutes idle.'
              : 'Parent Area locked — enter PIN again.'
          );
          renderPinGate();
        }
      };

      const offLocked = app?.events
        ? app.events.on('parent:locked', (d) => handleLocked(d?.reason))
        : null;

      const requireFreshSessionOrRelock = (code) => {
        if (code === 'parent-locked' || !parentSessionActive()) {
          handleLocked('idle');
          return true;
        }
        return false;
      };

      const renderPinGate = async () => {
        const pinExists = await hasPin();
        if (!alive) return;
        wrap.innerHTML = '';

        wrap.append(
          el(
            'header',
            { class: 'hud' },
            el('button', { type: 'button', class: 'hud-btn', onClick: () => router.go('#/kids') }, '◀ Back to Kids'),
            el('span', { class: 'pill' }, '🔒 Parent Area')
          )
        );

        if (!pinExists) {
          let firstPin = null;
          const pad = createPinPad({
            title: 'Set a Parent PIN',
            subtitle: 'Choose a 4–6 digit PIN to protect playtime approvals & settings.',
            submitLabel: 'Next',
            onCancel: () => router.go('#/kids'),
            onSubmit: async (entered) => {
              if (!firstPin) {
                firstPin = entered;
                pad.reset();
                pad.el.querySelector('h2').textContent = 'Confirm Parent PIN';
                pad.el.querySelector('p').textContent = 'Enter the same PIN once more to confirm.';
                return;
              }
              if (entered !== firstPin) {
                firstPin = null;
                pad.el.querySelector('h2').textContent = 'Set a Parent PIN';
                pad.el.querySelector('p').textContent = 'Choose a 4–6 digit PIN.';
                return { error: 'PINs did not match — please start again.' };
              }
              const res = await setPin(entered);
              if (!res?.ok) return { error: friendlyError(res?.reason, 'Could not save PIN.') };
              // Open the 2-minute parent session immediately after first-time PIN setup
              await verifyPin(entered);
              unlockedPin = entered;
              showToast('Parent PIN saved!', { tone: 'gold' });
              renderDashboard();
            },
          });
          wrap.append(pad.el);
        } else {
          const pad = createPinPad({
            title: 'Enter Parent PIN',
            subtitle: 'Unlock playtime approvals, kid settings, word lists, and backups.',
            submitLabel: 'Unlock',
            onCancel: () => router.go('#/kids'),
            onSubmit: async (entered) => {
              const res = await verifyPin(entered);
              if (res?.ok) {
                unlockedPin = entered;
                renderDashboard();
                return;
              }
              if (res?.lockedUntil && res.lockedUntil > Date.now()) {
                const mins = Math.ceil((res.lockedUntil - Date.now()) / 60000);
                return { error: `Too many tries. Locked for ~${mins} min.` };
              }
              return { error: `Incorrect PIN (${res?.triesLeft ?? 0} tries left).` };
            },
          });
          wrap.append(pad.el);
        }

        wrap.append(
          el(
            'p',
            { class: 'muted', style: 'text-align:center;font-size:13px;max-width:440px;margin:0 auto;' },
            'Note: The PIN is hashed locally (PBKDF2-SHA256) and auto-locks after 2 idle minutes or switching apps. It keeps casual hands out on the iPad, but does not encrypt device storage.'
          )
        );
      };

      const renderDashboard = async () => {
        if (!unlockedPin || !parentSessionActive()) {
          unlockedPin = null;
          renderPinGate();
          return;
        }
        const [profiles, pending, lists, rewardSettings, backupTs] = await Promise.all([
          listProfiles(),
          listPending().catch(() => []),
          Promise.resolve(getWordLists()),
          getRewardSettings().catch(() => ({ rewardName: 'PS5', minutesPerToken: 5, dailyEarnCap: 6 })),
          lastBackupAt().catch(() => null),
        ]);
        if (!alive) return;

        const rewardName = rewardSettings.rewardName || 'PS5';
        const profileById = new Map(profiles.map((p) => [p.id, p]));
        wrap.innerHTML = '';

        // Header
        wrap.append(
          el(
            'header',
            { class: 'hud' },
            el(
              'div',
              { class: 'hud-group' },
              el(
                'button',
                {
                  type: 'button',
                  class: 'hud-btn',
                  onClick: () => {
                    lockParent('manual');
                    router.go('#/kids');
                  },
                },
                '◀ Kids'
              ),
              el('h1', { class: 'h2' }, 'Parent Area')
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'hud-btn',
                onClick: () => {
                  unlockedPin = null;
                  lockParent('manual');
                  router.go('#/kids');
                },
              },
              '🔒 Lock & Exit'
            )
          )
        );

        // Tabs
        const tabDefs = [
          { id: 'approvals', label: `🎮 Approvals${pending.length ? ` (${pending.length})` : ''}` },
          { id: 'kids', label: '👧 Kids & Modes' },
          { id: 'lists', label: `📚 Word Lists (${lists.length})` },
          { id: 'progress', label: '📊 Progress' },
          { id: 'system', label: '⚙️ Speech & Backup' },
        ];
        wrap.append(
          el(
            'div',
            { class: 'tabs' },
            ...tabDefs.map((t) =>
              el(
                'button',
                {
                  type: 'button',
                  class: `tab-btn${activeTab === t.id ? ' is-active' : ''}`,
                  onClick: () => {
                    activeTab = t.id;
                    renderDashboard();
                  },
                },
                t.label
              )
            )
          )
        );

        // TAB 1: Playtime Approvals & Reward Settings
        if (activeTab === 'approvals') {
          if (pending.length === 0) {
            wrap.append(
              el(
                'div',
                { class: 'card' },
                el('h2', { class: 'h3' }, 'No Pending Playtime Requests'),
                el('p', { class: 'muted', style: 'margin:6px 0 0;' }, `When a child cashes in reward tokens in their Rewards Shop, their ${rewardName} approval card will appear right here.`)
              )
            );
          } else {
            for (const card of pending) {
              const kid = profileById.get(card.profileId);
              const kidName = kid?.name || 'your child';
              const cardReward = card.reward || rewardName;
              const steps = ps5Steps(card, kidName);

              wrap.append(
                el(
                  'div',
                  { class: 'ps5-card' },
                  el(
                    'div',
                    { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;' },
                    el('h2', { class: 'h2' }, `Give ${kidName} ${card.minutes} ${cardReward} minutes`),
                    el('span', { class: 'pill pill--gold' }, `${card.tokens} token${card.tokens === 1 ? '' : 's'}`)
                  ),
                  el('ol', { class: 'ps5-steps' }, ...steps.map((s) => el('li', {}, s))),
                  el(
                    'div',
                    { style: 'display:flex;flex-wrap:wrap;gap:10px;' },
                    el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--primary',
                        onClick: () => {
                          // M6: Confirm parent PIN on every "I Added It" so a kid can never self-approve
                          const confirmPad = createPinPad({
                            title: `Confirm ${card.minutes} min Added`,
                            subtitle: `Re-enter Parent PIN to mark ${kidName}'s ${card.minutes} ${cardReward} minutes as added.`,
                            submitLabel: '✓ Confirm Added',
                            onCancel: closeModal,
                            onSubmit: async (enteredPin) => {
                              const v = await verifyPin(enteredPin);
                              if (!v?.ok) {
                                return {
                                  error: v?.lockedUntil
                                    ? 'Too many wrong tries — locked briefly.'
                                    : `Wrong PIN (${v?.triesLeft ?? 0} tries left).`,
                                };
                              }
                              unlockedPin = enteredPin;
                              const res = await markAdded(card.id, enteredPin);
                              if (res?.ok) {
                                closeModal();
                                showToast(`Marked ${card.minutes} min added for ${kidName}!`, { tone: 'gold' });
                                renderDashboard();
                                return;
                              }
                              return { error: friendlyError(res?.reason, 'Could not approve right now.') };
                            },
                          });
                          openModal(confirmPad.el);
                        },
                      },
                      '✓ I Added It'
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--ghost',
                        onClick: () => {
                          speech.say(`${kidName} earned ${card.minutes} minutes of ${cardReward} time.`, { rate: 0.95 });
                        },
                      },
                      '🔊 Read Out Loud'
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--ghost',
                        onClick: async () => {
                          const res = await declineCard(card.id, unlockedPin);
                          if (res?.ok) {
                            showToast('Declined — tokens returned to child.');
                            renderDashboard();
                          } else if (!requireFreshSessionOrRelock(res?.reason)) {
                            showToast(friendlyError(res?.reason, 'Could not decline request.'));
                          }
                        },
                      },
                      'Decline & Refund'
                    )
                  )
                )
              );
            }
          }

          // Reward Economy Settings + Manual Token Adjustment
          let nameInput;
          let minInput;
          let capInput;
          let weeklyInput;
          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:12px;' }, 'Reward Token Rules'),
              el(
                'div',
                { class: 'field-grid' },
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Reward name'),
                  (nameInput = el('input', { type: 'text', value: rewardName, placeholder: 'PS5' }))
                ),
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Minutes per 1 token'),
                  (minInput = el('input', { type: 'number', min: 1, max: 60, value: rewardSettings.minutesPerToken ?? 5 }))
                ),
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Daily token earn cap per kid'),
                  (capInput = el('input', { type: 'number', min: 1, max: 50, value: rewardSettings.dailyEarnCap ?? 6 }))
                ),
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Weekly cap (optional, 0 = none)'),
                  (weeklyInput = el('input', { type: 'number', min: 0, max: 200, value: rewardSettings.weeklyEarnCap || 0 }))
                )
              ),
              el(
                'div',
                { style: 'margin-top:14px;' },
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--sm',
                    onClick: async () => {
                      // L3: Catch errors including parent-locked
                      try {
                        await setRewardSettings(
                          {
                            rewardName: nameInput.value.trim() || 'PS5',
                            minutesPerToken: Math.max(1, Math.round(Number(minInput.value) || 5)),
                            dailyEarnCap: Math.max(1, Math.round(Number(capInput.value) || 6)),
                            weeklyEarnCap: Number(weeklyInput.value) > 0 ? Math.round(Number(weeklyInput.value)) : null,
                          },
                          unlockedPin
                        );
                        showToast('Reward rules updated!', { tone: 'gold' });
                        renderDashboard();
                      } catch (err) {
                        if (!requireFreshSessionOrRelock(err?.code)) {
                          showToast(friendlyError(err, 'Could not save reward rules.'));
                        }
                      }
                    },
                  },
                  'Save Reward Rules'
                )
              )
            )
          );

          if (profiles.length) {
            let kidSelect;
            let deltaInput;
            let noteInput;
            wrap.append(
              el(
                'div',
                { class: 'card' },
                el('h3', { class: 'h3', style: 'margin-bottom:12px;' }, 'Manual Token Adjustment'),
                el(
                  'div',
                  { class: 'field-grid' },
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Kid'),
                    (kidSelect = el('select', {}, ...profiles.map((p) => el('option', { value: p.id }, p.name))))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Whole tokens (+ or -)'),
                    (deltaInput = el('input', { type: 'number', step: '1', value: 1 }))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Note'),
                    (noteInput = el('input', { type: 'text', placeholder: 'e.g. Great effort today!' }))
                  )
                ),
                el(
                  'div',
                  { style: 'margin-top:12px;' },
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'btn btn--ghost btn--sm',
                      onClick: async () => {
                        // L3: Reject non-integers (like 1.5) and inspect {ok, reason}
                        const tokens = Number(deltaInput.value);
                        if (!Number.isInteger(tokens) || tokens === 0) {
                          showToast(friendlyError('invalid-amount'));
                          return;
                        }
                        const res = await adjustTokens(
                          kidSelect.value,
                          tokens,
                          noteInput.value || 'Parent adjustment',
                          unlockedPin
                        );
                        if (res?.ok) {
                          showToast('Token balance updated!', { tone: 'gold' });
                          renderDashboard();
                        } else if (!requireFreshSessionOrRelock(res?.reason)) {
                          showToast(friendlyError(res?.reason, 'Could not update tokens.'));
                        }
                      },
                    },
                    'Apply Adjustment'
                  )
                )
              )
            );
          }
        }

        // TAB 2: Kids & Modes
        if (activeTab === 'kids') {
          let newName;
          let newMode;
          let newTheme;
          let newAvatar;

          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:12px;' }, 'Add a Kid Profile'),
              el(
                'div',
                { class: 'field-grid' },
                el('div', { class: 'field' }, el('label', {}, 'Name'), (newName = el('input', { type: 'text', placeholder: 'Kid name' }))),
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Mode'),
                  (newMode = el(
                    'select',
                    {},
                    el('option', { value: 'competition' }, 'Competition (5th Grade Bee)'),
                    el('option', { value: 'practice' }, 'Practice (3rd Grade)'),
                    el('option', { value: 'phonics' }, 'Phonics (Age 5)')
                  ))
                ),
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'World Theme'),
                  (newTheme = el('select', {}, ...THEME_LIST.map((t) => el('option', { value: t.id }, t.name))))
                ),
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Avatar'),
                  (newAvatar = el('select', {}, ...AVATARS.map((a) => el('option', { value: a.id }, `${a.emoji} ${a.label}`))))
                )
              ),
              el(
                'div',
                { style: 'margin-top:12px;' },
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--sm',
                    onClick: async () => {
                      const name = newName.value.trim();
                      if (!name) {
                        showToast('Please enter a name.');
                        return;
                      }
                      try {
                        await createProfile({
                          name,
                          mode: newMode.value,
                          theme: newTheme.value,
                          avatar: newAvatar.value,
                        });
                        showToast(`Added ${name}!`, { tone: 'gold' });
                        renderDashboard();
                      } catch (err) {
                        showToast(friendlyError(err, 'Could not create profile.'));
                      }
                    },
                  },
                  '+ Add Kid'
                )
              )
            )
          );

          for (const p of profiles) {
            let nameIn, modeIn, themeIn, kbIn, sizeIn, timerIn, rateIn, beeDateIn, beeRulesIn, showLenIn;

            wrap.append(
              el(
                'div',
                { class: 'card' },
                el(
                  'div',
                  { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;' },
                  el('h3', { class: 'h3' }, `${getAvatarEmoji(p.avatar)} ${p.name}`),
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'btn btn--ghost btn--sm',
                      onClick: async () => {
                        if (!window.confirm(`Delete ${p.name}'s profile?`)) return;
                        // L3: Catch deleteProfile errors
                        try {
                          await deleteProfile(p.id, unlockedPin);
                          showToast(`Deleted ${p.name}.`);
                          renderDashboard();
                        } catch (err) {
                          if (!requireFreshSessionOrRelock(err?.code)) {
                            showToast(friendlyError(err, 'Could not delete profile.'));
                          }
                        }
                      },
                    },
                    'Delete'
                  )
                ),
                el(
                  'div',
                  { class: 'field-grid' },
                  el('div', { class: 'field' }, el('label', {}, 'Name'), (nameIn = el('input', { type: 'text', value: p.name }))),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Mode'),
                    (modeIn = el(
                      'select',
                      {},
                      ...['competition', 'practice', 'phonics'].map((m) =>
                        el('option', { value: m, selected: p.mode === m }, m)
                      )
                    ))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Theme'),
                    (themeIn = el(
                      'select',
                      {},
                      ...THEME_LIST.map((t) => el('option', { value: t.id, selected: p.theme === t.id }, t.name))
                    ))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Keyboard Layout'),
                    (kbIn = el(
                      'select',
                      {},
                      ...['qwerty', 'abc', 'guided'].map((k) =>
                        el('option', { value: k, selected: (p.settings?.keyboard || 'qwerty') === k }, k.toUpperCase())
                      )
                    ))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Words per session'),
                    (sizeIn = el('input', { type: 'number', min: 3, max: 30, value: p.settings?.sessionSize || 8 }))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Stage timer sec (0 = off)'),
                    (timerIn = el('input', { type: 'number', min: 0, max: 180, value: p.settings?.timerSec || 0 }))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Speech rate (0.6 – 1.1)'),
                    (rateIn = el('input', { type: 'number', step: '0.05', min: '0.6', max: '1.1', value: p.settings?.rate ?? 0.85 }))
                  ),
                  el(
                    'div',
                    { class: 'field' },
                    el('label', {}, 'Bee Date (SRS compression)'),
                    (beeDateIn = el('input', { type: 'date', value: p.settings?.beeDate || '' }))
                  )
                ),
                el(
                  'div',
                  { style: 'margin-top:10px;' },
                  el(
                    'div',
                    { class: 'toggle-row' },
                    el('span', {}, 'Strict Bee Rules (disable Backspace on Stage)'),
                    (beeRulesIn = el('input', { type: 'checkbox', checked: Boolean(p.settings?.beeRules), style: 'width:24px;height:24px;' }))
                  ),
                  el(
                    'div',
                    { class: 'toggle-row' },
                    el('span', {}, 'Show word-length slots in Practice mode'),
                    (showLenIn = el('input', { type: 'checkbox', checked: p.settings?.showLength !== false, style: 'width:24px;height:24px;' }))
                  )
                ),
                el(
                  'div',
                  { style: 'margin-top:12px;' },
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'btn btn--primary btn--sm',
                      onClick: async () => {
                        try {
                          await updateProfile(p.id, {
                            name: nameIn.value.trim() || p.name,
                            mode: modeIn.value,
                            theme: themeIn.value,
                            settings: {
                              keyboard: kbIn.value,
                              sessionSize: Math.max(3, Number(sizeIn.value) || 8),
                              timerSec: Number(timerIn.value) > 0 ? Number(timerIn.value) : null,
                              rate: Number(rateIn.value) || 0.85,
                              beeDate: beeDateIn.value || null,
                              beeRules: beeRulesIn.checked,
                              showLength: showLenIn.checked,
                            },
                          });
                          showToast(`Saved ${nameIn.value.trim() || p.name}!`, { tone: 'gold' });
                          renderDashboard();
                        } catch (err) {
                          showToast(friendlyError(err, 'Could not save profile.'));
                        }
                      },
                    },
                    'Save Profile'
                  )
                )
              )
            );
          }
        }

        // TAB 3: Word Lists (M7: core marks imported lists with source === 'import')
        if (activeTab === 'lists') {
          const fileInput = el('input', {
            type: 'file',
            accept: '.json,application/json',
            style: 'display:none;',
            onChange: async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const imported = await importWordListFile(file);
                showToast(`Imported "${imported.title}" (${imported.words?.length || 0} words)!`, { tone: 'gold' });
                renderDashboard();
              } catch (err) {
                showToast(friendlyError(err, 'Could not import JSON word list.'));
              }
            },
          });

          wrap.append(
            el(
              'div',
              { class: 'card', style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;' },
              el(
                'div',
                {},
                el('h3', { class: 'h3' }, 'Import Word List JSON'),
                el('p', { class: 'muted', style: 'margin:4px 0 0;font-size:14px;' }, 'Accepts spellingbee.wordlist/1 or OCR draft JSON files from Files/AirDrop.')
              ),
              fileInput,
              el('button', { type: 'button', class: 'btn btn--primary btn--sm', onClick: () => fileInput.click() }, '📂 Choose JSON File')
            )
          );

          const listStack = el('div', { class: 'list-stack' });
          for (const wl of lists) {
            const isImported = wl.source === 'import' || wl.source?.kind === 'import' || wl.imported;
            listStack.append(
              el(
                'div',
                { class: 'word-row' },
                el(
                  'div',
                  {},
                  el('strong', { style: 'font-size:18px;' }, wl.title || wl.id),
                  el(
                    'div',
                    { class: 'muted', style: 'font-size:14px;' },
                    `${wl.words?.length || 0} words • ${isImported ? 'Imported' : 'Built-in'}${wl.beeDate ? ` • Bee date: ${wl.beeDate}` : ''}`
                  )
                ),
                isImported
                  ? el(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--ghost btn--sm',
                        onClick: async () => {
                          try {
                            await removeImportedList(wl.id);
                            showToast('Removed imported list.');
                            renderDashboard();
                          } catch (err) {
                            showToast(friendlyError(err, 'Could not remove list.'));
                          }
                        },
                      },
                      'Remove'
                    )
                  : el('span', { class: 'pill' }, 'Built-in')
              )
            );
          }
          wrap.append(listStack);
        }

        // TAB 4: Progress & Weak Words
        if (activeTab === 'progress') {
          for (const p of profiles) {
            const [ready, weak] = await Promise.all([
              readiness(p.id).catch(() => ({ total: 0, mastered: 0, seen: 0, fixit: 0, pct: 0 })),
              topMistakes(p.id, 10).catch(() => []),
            ]);
            if (!alive) return;

            const readyPct = ready.total > 0 ? Math.round((ready.pct || 0) * 100) : 0;
            wrap.append(
              el(
                'div',
                { class: 'card' },
                el(
                  'div',
                  { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;' },
                  el('h3', { class: 'h3' }, `${getAvatarEmoji(p.avatar)} ${p.name}`),
                  el('span', { class: 'pill pill--success' }, `${readyPct}% ready (${ready.mastered}/${ready.total} mastered • ${ready.fixit} Fix-It)`)
                ),
                el('div', { class: 'meter', style: 'margin-bottom:12px;' }, el('div', { class: 'meter__fill', style: `width:${Math.max(4, readyPct)}%` })),
                weak.length
                  ? el(
                      'div',
                      { style: 'display:flex;flex-wrap:wrap;gap:8px;' },
                      ...weak.map((item) => {
                        const w = typeof item.word === 'string' ? item.word : item.word?.word || item.key;
                        return el('span', { class: 'pill pill--warn' }, `${w}${item.wrong ? ` (${item.wrong}x)` : ''}`);
                      })
                    )
                  : el('p', { class: 'muted', style: 'margin:0;' }, 'No weak words recorded yet.')
              )
            );
          }
        }

        // TAB 5: Speech, Backup & PIN (B1a #7: pre-build backup before tap!)
        if (activeTab === 'system') {
          preparedBackup = null;
          let shareBtn;

          const voices = speech.voices ? speech.voices() : [];
          const currentV = speech.currentVoice ? speech.currentVoice() : null;
          let voiceSel;

          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:10px;' }, 'On-Device Speech Voice (iPadOS)'),
              el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:14px;' }, 'Uses on-device Apple voices only — zero network calls. Tap Test Voice to verify how words sound on this iPad.'),
              el(
                'div',
                { class: 'field-grid' },
                el(
                  'div',
                  { class: 'field' },
                  el('label', {}, 'Preferred Voice'),
                  (voiceSel = el(
                    'select',
                    {
                      onChange: () => {
                        if (speech.setVoice) speech.setVoice(voiceSel.value || null);
                        showToast('Voice preference saved.');
                      },
                    },
                    el('option', { value: '' }, 'Auto (best installed en-US)'),
                    ...voices.map((v) =>
                      el('option', { value: v.name, selected: currentV?.name === v.name }, `${v.name} (${v.lang})`)
                    )
                  ))
                )
              ),
              el(
                'div',
                { style: 'margin-top:12px;' },
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--sm',
                    onClick: () => {
                      speech.say('Rhythm. The drummer kept a steady rhythm.', { rate: 0.85 });
                    },
                  },
                  '🔊 Test Voice'
                )
              )
            )
          );

          // Offline Audio Download Card (wired to audio/clips.js downloadAllAudio / audioStatus / clearAudio)
          const audioStatusLine = el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:14px;' }, 'Checking bundled natural-voice audio…');
          const audioMeterWrap = el('div', { class: 'meter', style: 'margin-bottom:12px;', hidden: true });
          const audioMeterFill = el('div', { class: 'meter__fill', style: 'width:0%' });
          audioMeterWrap.append(audioMeterFill);

          let dlBtn;
          let cancelDlBtn;
          let clearDlBtn;

          const refreshAudioStatus = async () => {
            try {
              const st = await audioStatus();
              if (!alive || activeTab !== 'system') return;
              if (!st.total) {
                audioStatusLine.textContent = '0 of 0 clips saved on this iPad — device speech is active until audio clips are published.';
                if (dlBtn) {
                  dlBtn.disabled = true;
                  dlBtn.textContent = '📥 Download all audio for offline';
                }
                if (clearDlBtn) clearDlBtn.hidden = true;
                audioMeterWrap.hidden = true;
              } else {
                const pct = Math.round((st.cached / st.total) * 100);
                audioStatusLine.textContent =
                  st.cached >= st.total
                    ? `${st.cached} of ${st.total} clips saved on this iPad — ready for offline & airplane mode!`
                    : `${st.cached} of ${st.total} clips saved on this iPad (${pct}%). Connect to Wi-Fi before downloading (several MB).`;
                audioMeterWrap.hidden = false;
                audioMeterFill.style.width = `${Math.max(st.cached > 0 ? 4 : 0, pct)}%`;
                if (dlBtn) {
                  dlBtn.disabled = st.cached >= st.total;
                  dlBtn.textContent = st.cached >= st.total ? '✓ All audio saved offline' : '📥 Download all audio for offline';
                }
                if (clearDlBtn) clearDlBtn.hidden = st.cached === 0;
              }
            } catch {
              if (alive && activeTab === 'system') {
                audioStatusLine.textContent = 'Offline audio storage is unavailable in this browser mode.';
              }
            }
          };

          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:6px;' }, 'Offline Audio (Natural Voice)'),
              audioStatusLine,
              audioMeterWrap,
              el(
                'div',
                { style: 'display:flex;flex-wrap:wrap;gap:10px;' },
                (dlBtn = el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--sm',
                    onClick: async () => {
                      if (audioAbort) return;
                      audioAbort = new AbortController();
                      dlBtn.disabled = true;
                      dlBtn.textContent = 'Downloading…';
                      cancelDlBtn.hidden = false;
                      audioMeterWrap.hidden = false;
                      try {
                        const res = await downloadAllAudio({
                          signal: audioAbort.signal,
                          onProgress: ({ done, total, failed }) => {
                            if (!alive || activeTab !== 'system') return;
                            const pct = total ? Math.round((done / total) * 100) : 0;
                            audioMeterFill.style.width = `${Math.max(4, pct)}%`;
                            audioStatusLine.textContent = `Downloading on Wi-Fi: ${done} of ${total} clips saved on this iPad (${pct}%)${failed ? ` • ${failed} failed` : ''}`;
                          },
                        });
                        if (!alive) return;
                        if (res.ok) {
                          showToast(`All ${res.done} clips saved on this iPad!`, { tone: 'gold' });
                        } else if (res.aborted) {
                          showToast('Download cancelled — tap Download again anytime to resume.');
                        } else if (res.reason === 'storage-full') {
                          showToast('This iPad is out of storage space for more audio clips.');
                        } else if (res.reason === 'no-cache-storage') {
                          showToast('Offline audio storage is not available in this browser.');
                        } else if (res.reason === 'no-audio') {
                          showToast('No recorded audio clips are available yet.');
                        } else {
                          showToast(`Saved ${res.done} of ${res.total} clips (${res.failed} could not download).`);
                        }
                      } finally {
                        audioAbort = null;
                        if (cancelDlBtn) cancelDlBtn.hidden = true;
                        if (alive && activeTab === 'system') refreshAudioStatus();
                      }
                    },
                  },
                  '📥 Download all audio for offline'
                )),
                (cancelDlBtn = el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    hidden: true,
                    onClick: () => {
                      audioAbort?.abort();
                    },
                  },
                  'Cancel'
                )),
                (clearDlBtn = el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    hidden: true,
                    onClick: async () => {
                      await clearAudio();
                      showToast('Cleared downloaded audio clips.');
                      refreshAudioStatus();
                    },
                  },
                  'Clear Audio Cache'
                ))
              )
            )
          );
          refreshAudioStatus();

          const daysAgo = backupTs ? Math.floor((Date.now() - backupTs) / 86_400_000) : null;
          let backupMode = 'merge';
          const restoreInput = el('input', {
            type: 'file',
            accept: '.json,application/json',
            style: 'display:none;',
            onChange: async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const res = await importBackup(file, { mode: backupMode }, unlockedPin);
              if (res?.ok) {
                showToast('Backup imported successfully!', { tone: 'gold' });
                renderDashboard();
              } else {
                showToast(friendlyError(res?.reason, 'Backup import failed.'));
              }
            },
          });

          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:6px;' }, 'Offline Backup & Restore'),
              el(
                'p',
                { class: 'muted', style: 'margin:0 0 12px;font-size:14px;' },
                daysAgo === null
                  ? 'No backup exported yet. Export a JSON backup to Files or AirDrop to your Mac.'
                  : `Last backup: ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}${daysAgo >= 7 ? ' (recommended to back up soon!)' : ''}`
              ),
              restoreInput,
              el(
                'div',
                { style: 'display:flex;flex-wrap:wrap;gap:10px;' },
                (shareBtn = el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--sm',
                    disabled: true,
                    onClick: () => {
                      // B1a #7: call shareBackup(prepared) synchronously inside tap (NO await before it!)
                      const p = shareBackup(preparedBackup);
                      p.then((status) => {
                        if (!alive) return;
                        if (status !== 'cancelled') {
                          showToast(status === 'shared' ? 'Backup shared!' : 'Backup downloaded!', { tone: 'gold' });
                          renderDashboard();
                        }
                      }).catch((err) => {
                        if (alive) showToast(friendlyError(err, 'Could not share backup.'));
                      });
                    },
                  },
                  'Preparing Backup…'
                )),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    onClick: () => {
                      backupMode = 'merge';
                      restoreInput.click();
                    },
                  },
                  '📥 Import (Merge)'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    onClick: () => {
                      if (!window.confirm('Replace ALL local data with this backup file?')) return;
                      backupMode = 'replace';
                      restoreInput.click();
                    },
                  },
                  '📥 Import (Replace)'
                )
              )
            )
          );

          // Pre-build backup asynchronously while the panel is open so tap is synchronous
          prepareBackup()
            .then((readyFile) => {
              if (!alive || activeTab !== 'system') return;
              preparedBackup = readyFile;
              if (shareBtn) {
                shareBtn.disabled = false;
                shareBtn.textContent = '📤 Share / Export Backup';
              }
            })
            .catch(() => {
              if (shareBtn) {
                shareBtn.disabled = false;
                shareBtn.textContent = '📤 Export Backup';
              }
            });

          // Change PIN
          wrap.append(
            el(
              'div',
              { class: 'card' },
              el('h3', { class: 'h3', style: 'margin-bottom:8px;' }, 'Parent PIN'),
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost btn--sm',
                  onClick: () => {
                    const pad = createPinPad({
                      title: 'Choose New PIN',
                      subtitle: 'Enter a new 4–6 digit PIN.',
                      submitLabel: 'Save New PIN',
                      onCancel: closeModal,
                      onSubmit: async (nextPin) => {
                        const res = await setPin(nextPin, unlockedPin);
                        if (!res?.ok) return { error: friendlyError(res?.reason, 'Could not update PIN.') };
                        await verifyPin(nextPin);
                        unlockedPin = nextPin;
                        closeModal();
                        showToast('Parent PIN updated!', { tone: 'gold' });
                      },
                    });
                    openModal(pad.el);
                  },
                },
                '🔑 Change Parent PIN'
              )
            )
          );
        }
      };

      renderPinGate();

      return () => {
        alive = false;
        unlockedPin = null;
        if (audioAbort) {
          audioAbort.abort();
          audioAbort = null;
        }
        if (offLocked) offLocked();
        lockParent('manual');
        closeModal();
        speech.stop();
      };
    },
  };
}
