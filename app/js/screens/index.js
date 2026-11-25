/**
 * Screen registry for SpellQuest (bee-ui).
 * Mounted by main.js after DB + wordlists boot.
 */

import { KidPicker } from './profiles.js';
import { Home } from './home.js';
import { PracticeScreen } from './practice.js';
import { CompetitionScreen } from './competition.js';
import { PhonicsScreen } from './phonics.js';
import { MistakesScreen } from './mistakes.js';
import { RewardsScreen } from './rewards.js';
import { ParentScreen } from './parent.js';

export function registerScreens(ctx) {
  const { router } = ctx;

  const wrap = (factory) => ({
    mount(rootEl, params, query) {
      return factory(ctx).mount(rootEl, params, query);
    },
  });

  const PlayRouter = {
    mount(rootEl, params, query) {
      const kind = params?.kind || 'practice';
      if (kind === 'stage' || kind === 'competition') {
        return CompetitionScreen(ctx).mount(rootEl, params, query);
      }
      if (kind === 'phonics') {
        return PhonicsScreen(ctx).mount(rootEl, params, query);
      }
      return PracticeScreen(ctx).mount(rootEl, { ...params, kind: kind === 'review' ? 'review' : 'practice' }, query);
    },
  };

  router.on('#/kids', wrap(KidPicker));
  router.on('#/home/:profileId', wrap(Home));
  router.on('#/play/:profileId/:kind', PlayRouter);
  router.on('#/mistakes/:profileId', wrap(MistakesScreen));
  router.on('#/rewards/:profileId', wrap(RewardsScreen));
  router.on('#/parent', wrap(ParentScreen));
}
