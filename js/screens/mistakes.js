/**
 * Screen 5: Mistake Review (Fix-It Queue)
 * Lists tricky words, lets the kid listen/study letter-by-letter, and launches a Fix-It review round.
 */

import { getProfile } from '../store/profiles.js';
import { wordsForProfile } from '../store/wordlists.js';
import { topMistakes, fixitCount } from '../engine/runner.js';
import { speech } from '../audio/speech.js';
import { el } from '../ui/components.js';
import { applyTheme, getAvatarEmoji } from '../ui/themes.js';

const PATTERN_LABELS = {
  'double-letter': 'Double letters',
  'silent-letter': 'Silent letter',
  swap: 'Swapped letters',
  'ie-ei': 'ie / ei pattern',
  ending: 'Word ending',
  vowel: 'Tricky vowel',
};

export function MistakesScreen({ router, app }) {
  return {
    mount(rootEl, params) {
      let alive = true;
      const profileId = params?.profileId;
      const section = el('section', { class: 'screen screen--scroll is-active', dataset: { screen: 'mistakes' } });
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

        const [count, items] = await Promise.all([
          fixitCount(profile.id).catch(() => 0),
          topMistakes(profile.id, 40).catch(() => []),
        ]);
        if (!alive) return;

        wrap.innerHTML = '';

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
                el('div', { class: 'kid-badge__meta' }, el('strong', {}, profile.name), el('span', {}, 'Mistake Review'))
              )
            ),
            el('span', { class: `pill ${count > 0 ? 'pill--warn' : 'pill--success'}` }, count > 0 ? `${count} Fix-It words` : 'All Clear!')
          )
        );

        // Hero launcher
        wrap.append(
          el(
            'div',
            { class: 'card', style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;' },
            el(
              'div',
              { style: 'display:flex;flex-direction:column;gap:4px;' },
              el('h1', { class: 'h2' }, count > 0 ? 'Tame Your Tricky Words' : 'Your Fix-It List is Clear! 🎉'),
              el(
                'p',
                { class: 'muted', style: 'margin:0;font-size:15px;' },
                count > 0
                  ? 'Spell a tricky word right in 2 separate sessions to graduate it for bonus XP!'
                  : 'Great work! Jump into Practice or On Stage to keep leveling up.'
              )
            ),
            count > 0
              ? el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--lg',
                    onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/review`),
                  },
                  '🛠️ Start Fix-It Round'
                )
              : el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary',
                    onClick: () => router.go(`#/play/${encodeURIComponent(profile.id)}/practice`),
                  },
                  '✨ Go to Practice'
                )
          )
        );

        if (!items.length) return;

        const byKey = new Map(wordsForProfile(profile).map((w) => [w.key, w]));
        const list = el('div', { class: 'list-stack' });
        for (const item of items) {
          const wordRec = byKey.get(item.key) || (typeof item.word === 'object' ? item.word : { word: item.word });
          const wordStr = wordRec?.word || String(item.word || '');
          const syllables = wordRec?.syllables || '';
          const wrongCount = item.wrong ?? 0;
          const lastMiss = item.lastAttempts?.slice(-1)[0];
          const patterns = item.patterns || [];

          list.append(
            el(
              'div',
              { class: 'word-row' },
              el(
                'div',
                { style: 'display:flex;flex-direction:column;gap:4px;' },
                el(
                  'div',
                  { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;' },
                  el('strong', { style: 'font-size:21px;letter-spacing:0.02em;' }, wordStr),
                  syllables ? el('span', { class: 'pill' }, syllables) : null,
                  item.fixit ? el('span', { class: 'pill pill--warn' }, 'Fix-It') : null,
                  wrongCount > 0 ? el('span', { class: 'pill' }, `${wrongCount} miss${wrongCount === 1 ? '' : 'es'}`) : null
                ),
                lastMiss || patterns.length
                  ? el(
                      'div',
                      { class: 'muted', style: 'font-size:14px;display:flex;gap:10px;flex-wrap:wrap;' },
                      lastMiss ? el('span', {}, `Last try: ${lastMiss}`) : null,
                      patterns.length
                        ? el('span', {}, patterns.map((p) => PATTERN_LABELS[p] || p).join(' • '))
                        : null
                    )
                  : null
              ),
              el(
                'div',
                { style: 'display:flex;gap:8px;' },
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--sm btn--ghost',
                    onClick: () => {
                      // Sync speech call inside tap (T2 §1)
                      speech.sayWord(wordRec);
                    },
                  },
                  '🔊 Hear'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--sm',
                    onClick: () => {
                      speech.sayWordSpelled(wordRec);
                    },
                  },
                  '🔤 Spell'
                )
              )
            )
          );
        }

        wrap.append(list);
      };

      render();
      return () => {
        alive = false;
        speech.stop();
      };
    },
  };
}
