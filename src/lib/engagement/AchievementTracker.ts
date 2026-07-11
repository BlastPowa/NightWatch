/**
 * Local Engagement Dashboard core (§7.4, ADR-009): counts session events,
 * evaluates achievement rules, and persists everything locally. No network
 * path — other members can never see this data in MVP.
 */

export interface EngagementStats {
  roomsJoined: number;
  watchSeconds: number;
  reactionsSent: number;
  chatsSent: number;
  videosLoaded: number;
  /** Consecutive days with watch activity (Phase 18). */
  streakDays: number;
  /** YYYY-MM-DD of the last day watch activity was recorded. */
  lastWatchDay: string | null;
}

export type EngagementEvent = 'room-joined' | 'video-loaded' | 'reaction-sent' | 'chat-sent';

export interface AchievementDef {
  id: string;
  emoji: string;
  title: string;
  description: string;
  isUnlocked(stats: EngagementStats): boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-night',
    emoji: '🌙',
    title: 'First Night',
    description: 'Join your first room.',
    isUnlocked: (s) => s.roomsJoined >= 1,
  },
  {
    id: 'regular',
    emoji: '🛋️',
    title: 'Regular',
    description: 'Join 10 rooms.',
    isUnlocked: (s) => s.roomsJoined >= 10,
  },
  {
    id: 'veteran',
    emoji: '🏆',
    title: 'Night Veteran',
    description: 'Join 50 rooms.',
    isUnlocked: (s) => s.roomsJoined >= 50,
  },
  {
    id: 'marathon',
    emoji: '⏱️',
    title: 'Marathon',
    description: 'Watch 1 hour in total.',
    isUnlocked: (s) => s.watchSeconds >= 3600,
  },
  {
    id: 'binge-lord',
    emoji: '🍿',
    title: 'Binge Lord',
    description: 'Watch 10 hours in total.',
    isUnlocked: (s) => s.watchSeconds >= 36_000,
  },
  {
    id: 'reactor',
    emoji: '🔥',
    title: 'Reactor',
    description: 'Send 50 reactions.',
    isUnlocked: (s) => s.reactionsSent >= 50,
  },
  {
    id: 'chatterbox',
    emoji: '💬',
    title: 'Chatterbox',
    description: 'Send 100 chat messages.',
    isUnlocked: (s) => s.chatsSent >= 100,
  },
  {
    id: 'curator',
    emoji: '🎬',
    title: 'Curator',
    description: 'Load 10 videos for the room.',
    isUnlocked: (s) => s.videosLoaded >= 10,
  },
  {
    id: 'streak-3',
    emoji: '🔥',
    title: 'Warming Up',
    description: 'Watch 3 days in a row.',
    isUnlocked: (s) => s.streakDays >= 3,
  },
  {
    id: 'streak-7',
    emoji: '⚡',
    title: 'Weekly Ritual',
    description: 'Watch 7 days in a row.',
    isUnlocked: (s) => s.streakDays >= 7,
  },
  {
    id: 'streak-30',
    emoji: '👑',
    title: 'Night Sovereign',
    description: 'Watch 30 days in a row.',
    isUnlocked: (s) => s.streakDays >= 30,
  },
];

export interface EngagementSnapshot {
  stats: EngagementStats;
  unlockedIds: readonly string[];
}

type SnapshotListener = (snapshot: EngagementSnapshot) => void;
type UnlockListener = (achievement: AchievementDef) => void;

const STORAGE_KEY = 'nightwatch:engagement';

const DEFAULT_STATS: EngagementStats = {
  roomsJoined: 0,
  watchSeconds: 0,
  reactionsSent: 0,
  chatsSent: 0,
  videosLoaded: 0,
  streakDays: 0,
  lastWatchDay: null,
};

/** Local calendar day, YYYY-MM-DD. */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return todayKey(date);
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function loadSnapshot(): EngagementSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return { stats: { ...DEFAULT_STATS }, unlockedIds: [] };
    }
    const parsed = JSON.parse(raw) as Partial<{
      stats: Partial<EngagementStats>;
      unlockedIds: unknown;
    }>;
    const stats: EngagementStats = {
      roomsJoined: toCount(parsed.stats?.roomsJoined),
      watchSeconds: toCount(parsed.stats?.watchSeconds),
      reactionsSent: toCount(parsed.stats?.reactionsSent),
      chatsSent: toCount(parsed.stats?.chatsSent),
      videosLoaded: toCount(parsed.stats?.videosLoaded),
      streakDays: toCount(parsed.stats?.streakDays),
      lastWatchDay:
        typeof parsed.stats?.lastWatchDay === 'string' ? parsed.stats.lastWatchDay : null,
    };
    const unlockedIds = Array.isArray(parsed.unlockedIds)
      ? parsed.unlockedIds.filter(
          (id): id is string =>
            typeof id === 'string' && ACHIEVEMENTS.some((a) => a.id === id),
        )
      : [];
    return { stats, unlockedIds };
  } catch {
    return { stats: { ...DEFAULT_STATS }, unlockedIds: [] };
  }
}

class AchievementTracker {
  private snapshot: EngagementSnapshot = loadSnapshot();
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly unlockListeners = new Set<UnlockListener>();
  private pendingWatchSeconds = 0;

  public get(): EngagementSnapshot {
    return this.snapshot;
  }

  public record(event: EngagementEvent): void {
    const stats = { ...this.snapshot.stats };
    switch (event) {
      case 'room-joined':
        stats.roomsJoined += 1;
        break;
      case 'video-loaded':
        stats.videosLoaded += 1;
        break;
      case 'reaction-sent':
        stats.reactionsSent += 1;
        break;
      case 'chat-sent':
        stats.chatsSent += 1;
        break;
    }
    this.commit(stats);
  }

  /** Called once per second of active playback; persisted in 10s batches. */
  public tickWatch(seconds: number): void {
    this.pendingWatchSeconds += seconds;
    if (this.pendingWatchSeconds >= 10) {
      const stats = {
        ...this.snapshot.stats,
        watchSeconds: this.snapshot.stats.watchSeconds + this.pendingWatchSeconds,
      };
      this.pendingWatchSeconds = 0;

      // Streak (Phase 18): consecutive calendar days with watch activity.
      const today = todayKey();
      if (stats.lastWatchDay !== today) {
        stats.streakDays = stats.lastWatchDay === yesterdayKey() ? stats.streakDays + 1 : 1;
        stats.lastWatchDay = today;
      }

      this.commit(stats);
    }
  }

  /**
   * Cloud sync (Phase 18): adopt a merged snapshot. Unlocks already earned on
   * another device are seeded as previously-unlocked so commit() does not
   * replay them as fresh toasts.
   */
  public applyMerged(stats: EngagementStats, unlockedIds: readonly string[]): void {
    const known = unlockedIds.filter((id) => ACHIEVEMENTS.some((a) => a.id === id));
    this.snapshot = { stats: this.snapshot.stats, unlockedIds: known };
    this.commit(stats);
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  public onUnlock(listener: UnlockListener): () => void {
    this.unlockListeners.add(listener);
    return () => {
      this.unlockListeners.delete(listener);
    };
  }

  private commit(stats: EngagementStats): void {
    const previouslyUnlocked = new Set(this.snapshot.unlockedIds);
    const unlockedIds: string[] = [...this.snapshot.unlockedIds];
    const newlyUnlocked: AchievementDef[] = [];

    for (const achievement of ACHIEVEMENTS) {
      if (!previouslyUnlocked.has(achievement.id) && achievement.isUnlocked(stats)) {
        unlockedIds.push(achievement.id);
        newlyUnlocked.push(achievement);
      }
    }

    this.snapshot = { stats, unlockedIds };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot));
    } catch {
      // Storage full/unavailable — keep in-memory state.
    }
    this.snapshotListeners.forEach((listener) => listener(this.snapshot));
    newlyUnlocked.forEach((achievement) =>
      this.unlockListeners.forEach((listener) => listener(achievement)),
    );
  }
}

/** App-wide singleton engagement tracker. */
export const achievementTracker = new AchievementTracker();
