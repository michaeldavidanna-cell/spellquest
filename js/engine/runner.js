// Connects the pure Session/PhonicsSession to storage and rewards.
// submit()/answer() stay SYNCHRONOUS so screens can speak in the same tap;
// saving happens in the background and is exposed as `session.saved`.
import { db, newId } from '../store/db.js';
import { getProfile } from '../store/profiles.js';
import { wordsForProfile, beeDateForProfile } from '../store/wordlists.js';
import { applyEarnings, getLedger, getRewardSettings } from '../rewards/wallet.js';
import { updateStreak } from '../rewards/economy.js';
import { Session, buildQueue, readiness as readinessPure, topMistakes as topMistakesPure } from './session.js';
import { PhonicsSession, buildPhonicsRounds, buildLadderRounds, ladderStatus, LEGACY_TYPES, PHONICS_TYPES } from './phonics.js';
import { loadPhonicsLadder } from '../store/phonics.js';

async function loadProgress(profileId) {
  const rows = await db.getAllBy('progress', 'byProfile', profileId);
  return new Map(rows.map((r) => [r.key, r]));
}

function makeTimer(limitSec) {
  let start = 0; let handle = null; let stopped = true;
  return {
    limitSec,
    start(onTick, onTimeUp) {
      this.stop();
      start = Date.now(); stopped = false;
      handle = setInterval(() => {
        const left = this.remaining();
        onTick?.(left);
        if (left <= 0) { this.stop(); onTimeUp?.(); }
      }, 250);
    },
    stop() { if (handle) clearInterval(handle); handle = null; stopped = true; },
    remaining() { return stopped && !start ? limitSec : Math.max(0, limitSec - (Date.now() - start) / 1000); },
    running() { return !stopped; },
  };
}

function wrap(inner, { profile, settings, kind, persistAnswer }) {
  let saved = Promise.resolve();
  const queue = (fn) => { saved = saved.then(fn).catch((err) => console.error('[runner] save failed', err)); return saved; };

  const api = {
    id: inner.id,
    kind,
    profileId: profile.id,
    get words() { return inner.words ?? inner.rounds; },
    get index() { return inner.index; },
    get total() { return inner.total; },
    get saved() { return saved; },
    current: () => inner.current(),
    next: () => { api.timer?.stop(); return inner.next(); },
    isDone: () => inner.isDone(),
    /** Idempotent: every call returns the same promise, so a double tap can't pay twice. */
    finish() {
      if (!finishing) finishing = doFinish({ abandoned: false });
      return finishing;
    },
    /**
     * The child left mid-round (Map, back, new route). Answers are already saved; if at least
     * one counted answer exists, the round is closed like finish() (session XP/coins/tokens by
     * the normal rules, streak day) and the summary has abandoned:true. With no answers it
     * resolves to null and records nothing. Safe to call from a screen cleanup without await,
     * and safe to call after finish() (returns the finish promise).
     */
    abandon() {
      if (finishing) return finishing;
      api.timer?.stop();
      if (!inner.answers?.length) { finishing = Promise.resolve(null); return finishing; }
      finishing = doFinish({ abandoned: true });
      return finishing;
    },
    get finished() { return !!finishing; },
  };
  let finishing = null;
  async function doFinish({ abandoned }) {
    api.timer?.stop();
    const { summary, ledgerEntries } = inner.finish();
    const fresh = await getProfile(profile.id);
    const st = updateStreak(fresh?.streak, Date.now());
    const extra = [];
    if (st.bonusTokens && summary.answered > 0) {
      const t = inner.earnTokens(st.bonusTokens, `streak:${st.streak.count}`);
      if (t.entry) extra.push(t.entry);
      summary.tokens += t.granted;
      if (t.capped) summary.tokenCapped = true;
    }
    summary.streak = summary.answered > 0 ? st.streak.count : (fresh?.streak?.count ?? 0);
    summary.minutesEarned = summary.tokens * settings.minutesPerToken;
    summary.rewardName = settings.rewardName;
    summary.minutesPerToken = settings.minutesPerToken;
    summary.abandoned = abandoned;
    const sessionXp = summary.xp - inner.answeredXp;
    const sessionCoins = summary.coins - inner.answeredCoins;
    await queue(async () => {
      await applyEarnings(profile.id, {
        xp: sessionXp, coins: sessionCoins, ledgerEntries: [...ledgerEntries, ...extra],
        profilePatch: summary.answered > 0 ? { streak: st.streak } : null,
      });
      await db.put('sessions', { id: inner.id, profileId: profile.id, kind, startedAt: inner.startedAt ?? null,
        endedAt: Date.now(), answers: inner.answers, summary });
    });
    await saved;
    return summary;
  }
  inner.answeredXp = 0;
  inner.answeredCoins = 0;
  api.persist = (result, key) => {
    inner.answeredXp += result.reward.xp;
    inner.answeredCoins += result.reward.coins;
    queue(() => persistAnswer(result, key));
  };
  return api;
}

/**
 * @param {string} profileId
 * @param {{kind?:'practice'|'stage'|'review', size?:number|'all'}} opts
 */
export async function startSession(profileId, { kind, size } = {}) {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error('Profile not found');
  if (profile.mode === 'phonics' && !kind) return startPhonics(profileId);
  kind = kind ?? (profile.mode === 'competition' ? 'stage' : 'practice');
  const [progress, ledger, settings] = await Promise.all([loadProgress(profileId), getLedger(profileId), getRewardSettings()]);
  const words = wordsForProfile(profile);
  const beeDate = beeDateForProfile(profile);
  const queue = buildQueue({ words, progress, kind, size: size ?? profile.settings.sessionSize, beeDate });
  const inner = new Session({
    id: newId('sess'), profileId, kind, words: queue, progress, beeDate, rewardSettings: settings, ledger,
    allowRetry: kind !== 'stage',
  });
  const persistAnswer = async (result, key) => {
    if (result.counted && result.progress) await db.put('progress', { ...result.progress, key, profileId });
    await applyEarnings(profileId, { xp: result.reward.xp, coins: result.reward.coins, ledgerEntries: result.ledgerEntries });
  };
  const api = wrap(inner, { profile, settings, kind, persistAnswer });
  api.submit = (letters, opts) => {
    if (api.finished) return null; // round already closed
    const key = inner.current()?.key;
    const result = inner.submit(letters, opts);
    api.timer?.stop();
    api.persist(result, key);
    return result;
  };
  api.peek = () => inner.peek();
  api.skip = () => {
    if (api.finished) return null;
    const key = inner.current()?.key;
    const before = inner.tries;
    const result = inner.skip();
    if (before === 0) api.persist(result, key);
    return result;
  };
  api.canRetry = () => inner.canRetry();
  if (kind === 'stage' && profile.settings.timerSec) api.timer = makeTimer(profile.settings.timerSec);
  return api;
}

/**
 * @param {string} profileId
 * @param {{rounds?:number, types?:string[]}} opts types = round types the screen can show
 *   (default: the B2 types find-letter, first-sound, build). Add 'choose' and 'build-phrase'
 *   to unlock rhyming, sight-word recognition and phrase levels.
 */
export async function startPhonics(profileId, { rounds, types = LEGACY_TYPES } = {}) {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error('Profile not found');
  const [progress, ledger, settings, ladder] = await Promise.all([
    loadProgress(profileId), getLedger(profileId), getRewardSettings(), loadPhonicsLadder()]);
  const n = rounds ?? profile.settings.sessionSize ?? 5;
  const okTypes = types.filter((t) => PHONICS_TYPES.includes(t));
  const built = ladder ? buildLadderRounds({ ladder, rounds: n, progress, types: okTypes }) : [];
  const inner = new PhonicsSession({
    id: newId('phon'), profileId, rounds: built.length ? built : buildPhonicsRounds({ rounds: n, progress }), progress,
    rewardSettings: settings, ledger, ladder: built.length ? ladder : null, types: okTypes,
  });
  inner.startedAt = Date.now();
  const persistAnswer = async (result, key) => {
    if (result.progress) await db.put('progress', { ...result.progress, key, profileId });
    await applyEarnings(profileId, { xp: result.reward.xp, coins: result.reward.coins });
  };
  const api = wrap(inner, { profile, settings, kind: 'phonics', persistAnswer });
  api.answer = (input) => {
    if (api.finished) return null;
    const key = inner.current()?.key;
    const result = inner.answer(input);
    if (!result.partial) api.persist(result, key);
    return result;
  };
  api.ladder = inner.ladderBefore; // { levels:[...], current, currentIndex, allMastered } or null
  const curLevel = api.ladder?.levels.find((l) => l.id === api.ladder.current);
  api.level = curLevel ? curLevel.index + 1 : null;      // 1-based ladder level
  api.levelName = curLevel ? curLevel.title : null;
  return api;
}

/** Ladder progress for a phonics profile (parent view / level map). Null if the ladder file is missing. */
export async function phonicsLadder(profileId, { types = LEGACY_TYPES } = {}) {
  const [ladder, progress] = await Promise.all([loadPhonicsLadder(), loadProgress(profileId)]);
  return ladder ? ladderStatus(ladder, progress, { types }) : null;
}

export async function fixitCount(profileId) {
  const progress = await loadProgress(profileId);
  const profile = await getProfile(profileId);
  const keys = new Set(wordsForProfile(profile).map((w) => w.key));
  return [...progress.values()].filter((p) => p.fixit && keys.has(p.key)).length;
}

export async function readiness(profileId) {
  const profile = await getProfile(profileId);
  return readinessPure(wordsForProfile(profile), await loadProgress(profileId));
}

export async function topMistakes(profileId, n = 10) {
  const profile = await getProfile(profileId);
  return topMistakesPure(wordsForProfile(profile), await loadProgress(profileId), n);
}
