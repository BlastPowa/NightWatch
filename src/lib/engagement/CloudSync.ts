import type { Session } from '@supabase/supabase-js';
import { log } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import {
  achievementTracker,
  type EngagementStats,
} from '@/lib/engagement/AchievementTracker';

/**
 * Phase 18 (§14.4): cross-device stats & achievements for signed-in users.
 * The tracker's interface is unchanged (ADR-009's designed upgrade path):
 * this module merges cloud+local on sign-in (max of each counter — no
 * progress is ever lost) and write-through syncs on changes, debounced.
 * Guests stay purely local.
 */

interface StatsRow {
  rooms_joined: number;
  watch_seconds: number;
  reactions_sent: number;
  chats_sent: number;
  videos_loaded: number;
  streak_days: number;
  last_watch_day: string | null;
  share_stats: boolean;
}

const SYNC_DEBOUNCE_MS = 15_000;

/** Reactive view of sync state for the UI (see subscribeCloudSync). */
export interface CloudSyncState {
  synced: boolean;
  shareStats: boolean;
}

let userId: string | null = null;
let displayName = '';
/**
 * Phase 20B: sharing is opt-IN. This must match the share_stats column default
 * (false, per 0006) — pushSnapshot writes this value, so defaulting it true
 * here would silently opt every new user in on their first sync and defeat the
 * column default entirely.
 */
let shareStats = false;
let syncTimer: number | null = null;
let initialized = false;

let state: CloudSyncState = { synced: false, shareStats: false };
const stateListeners = new Set<(state: CloudSyncState) => void>();

/**
 * Resolves once we know whether the user is signed in AND, if so, what their
 * real share_stats consent is. Callers that act on consent (the Phase 19
 * friend graph) must await this: shareStats defaults to true, so acting before
 * the cloud row lands could record an opted-out user.
 */
let markReady: () => void = () => {};
const readyPromise = new Promise<void>((resolve) => {
  markReady = resolve;
});

export function whenSyncReady(): Promise<void> {
  return readyPromise;
}

/** Recompute the cached snapshot; identity changes only when values change. */
function publishState(): void {
  const next: CloudSyncState = { synced: userId !== null, shareStats };
  if (next.synced === state.synced && next.shareStats === state.shareStats) {
    return;
  }
  state = next;
  stateListeners.forEach((listener) => listener(state));
}

export function subscribeCloudSync(listener: (state: CloudSyncState) => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function getCloudSyncState(): CloudSyncState {
  return state;
}

function mergeStats(local: EngagementStats, cloud: StatsRow | null): EngagementStats {
  if (cloud === null) {
    return local;
  }
  // Streak: prefer the more recent watch day; tie → higher streak.
  const cloudDay = cloud.last_watch_day;
  const localDay = local.lastWatchDay;
  let streakDays: number;
  let lastWatchDay: string | null;
  if (cloudDay === localDay) {
    streakDays = Math.max(local.streakDays, cloud.streak_days);
    lastWatchDay = localDay;
  } else if (cloudDay !== null && (localDay === null || cloudDay > localDay)) {
    streakDays = cloud.streak_days;
    lastWatchDay = cloudDay;
  } else {
    streakDays = local.streakDays;
    lastWatchDay = localDay;
  }
  return {
    roomsJoined: Math.max(local.roomsJoined, cloud.rooms_joined),
    watchSeconds: Math.max(local.watchSeconds, cloud.watch_seconds),
    reactionsSent: Math.max(local.reactionsSent, cloud.reactions_sent),
    chatsSent: Math.max(local.chatsSent, cloud.chats_sent),
    videosLoaded: Math.max(local.videosLoaded, cloud.videos_loaded),
    streakDays,
    lastWatchDay,
  };
}

async function pushSnapshot(): Promise<void> {
  if (userId === null) {
    return;
  }
  const { stats, unlockedIds } = achievementTracker.get();
  await supabase.from('player_stats').upsert({
    user_id: userId,
    display_name: displayName.slice(0, 24),
    share_stats: shareStats,
    rooms_joined: stats.roomsJoined,
    watch_seconds: stats.watchSeconds,
    reactions_sent: stats.reactionsSent,
    chats_sent: stats.chatsSent,
    videos_loaded: stats.videosLoaded,
    streak_days: stats.streakDays,
    last_watch_day: stats.lastWatchDay,
    updated_at: new Date().toISOString(),
  });
  if (unlockedIds.length > 0) {
    await supabase
      .from('player_achievements')
      .upsert(
        unlockedIds.map((id) => ({ user_id: userId, achievement_id: id })),
        { onConflict: 'user_id,achievement_id', ignoreDuplicates: true },
      );
  }
}

function scheduleSync(): void {
  if (userId === null || syncTimer !== null) {
    return;
  }
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    pushSnapshot().catch(() => {});
  }, SYNC_DEBOUNCE_MS);
}

/** Push any debounced changes immediately — the app may be closing. */
function flushSync(): void {
  if (syncTimer === null) {
    return;
  }
  window.clearTimeout(syncTimer);
  syncTimer = null;
  pushSnapshot().catch(() => {});
}

async function onSignIn(session: Session): Promise<void> {
  userId = session.user.id;
  const meta = session.user.user_metadata as Record<string, unknown>;
  displayName =
    (typeof meta['full_name'] === 'string' && meta['full_name']) ||
    (typeof meta['name'] === 'string' && meta['name']) ||
    'Player';

  const [{ data: statsRow }, { data: achRows }] = await Promise.all([
    supabase.from('player_stats').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('player_achievements').select('achievement_id').eq('user_id', userId),
  ]);

  const cloud = (statsRow as StatsRow | null) ?? null;
  if (cloud !== null) {
    shareStats = cloud.share_stats;
  }
  publishState();
  const local = achievementTracker.get();
  const merged = mergeStats(local.stats, cloud);
  const cloudUnlocks = Array.isArray(achRows)
    ? achRows.map((r) => (r as { achievement_id: string }).achievement_id)
    : [];
  const unionUnlocks = [...new Set([...local.unlockedIds, ...cloudUnlocks])];

  achievementTracker.applyMerged(merged, unionUnlocks);
  await pushSnapshot();
  log('info', 'Engagement stats synced with cloud');
}

/** Wire once at startup (idempotent). */
export function initCloudSync(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  void supabase.auth
    .getSession()
    .then(async ({ data }) => {
      if (data.session !== null) {
        await onSignIn(data.session).catch(() => {});
      }
    })
    .finally(markReady);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session !== null) {
      void onSignIn(session)
        .catch(() => {})
        .finally(markReady);
    }
    if (event === 'SIGNED_OUT') {
      flushSync();
      userId = null;
      publishState();
    }
  });

  // App-lifetime singleton: the tracker subscription is never torn down.
  achievementTracker.subscribe(() => scheduleSync());

  // A debounced write must not be lost when the tab/app goes away.
  window.addEventListener('pagehide', flushSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSync();
    }
  });
}

/** Leaderboard opt-out toggle (Phase 18). */
export function setShareStats(value: boolean): void {
  shareStats = value;
  publishState();
  pushSnapshot().catch(() => {});
}
