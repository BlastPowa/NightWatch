import { useEffect, useState, useSyncExternalStore } from 'react';
import { ACHIEVEMENTS, achievementTracker } from '@/lib/engagement/AchievementTracker';
import {
  getCloudSyncState,
  setShareStats,
  subscribeCloudSync,
} from '@/lib/engagement/CloudSync';
import {
  getLeaderboard,
  LEADERBOARD_METRICS,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardScope,
} from '@/lib/engagement/LeaderboardService';

function formatMetricValue(metric: LeaderboardMetric, value: number): string {
  if (metric === 'watch_seconds') {
    return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  }
  if (metric === 'streak_days') {
    return `${value}🔥`;
  }
  return String(value);
}

interface UserCardProps {
  displayName: string;
}

function formatWatchTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Local Engagement Dashboard view (§7.4, ADR-009 — device-local only). */
export function UserCard({ displayName }: UserCardProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    (onChange) => achievementTracker.subscribe(onChange),
    () => achievementTracker.get(),
  );
  const unlocked = new Set(snapshot.unlockedIds);

  // Leaderboard (Phase 18, temporary UI — frontend lane restyles).
  const { synced: cloud, shareStats: share } = useSyncExternalStore(
    subscribeCloudSync,
    getCloudSyncState,
  );
  const [metric, setMetric] = useState<LeaderboardMetric>('watch_seconds');
  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!cloud) {
      setEntries([]);
      return;
    }
    let active = true;
    void getLeaderboard(metric, scope).then((rows) => {
      if (active) {
        setEntries(rows);
      }
    });
    return () => {
      active = false;
    };
  }, [cloud, metric, scope]);

  return (
    <div className="settings-page fade-up">
      <h1 className="page-title">My Card</h1>

      <section className="card user-card">
        <div className="user-card-header">
          <span className="user-avatar">{(displayName[0] ?? '?').toUpperCase()}</span>
          <div>
            <p className="user-name">{displayName.length > 0 ? displayName : 'Anonymous'}</p>
            <p className="user-sub">
              {snapshot.unlockedIds.length}/{ACHIEVEMENTS.length} achievements
            </p>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <span className="stat-value">{snapshot.stats.roomsJoined}</span>
            <span className="stat-label">Rooms</span>
          </div>
          <div className="stat">
            <span className="stat-value">{formatWatchTime(snapshot.stats.watchSeconds)}</span>
            <span className="stat-label">Watched</span>
          </div>
          <div className="stat">
            <span className="stat-value">{snapshot.stats.reactionsSent}</span>
            <span className="stat-label">Reactions</span>
          </div>
          <div className="stat">
            <span className="stat-value">{snapshot.stats.chatsSent}</span>
            <span className="stat-label">Messages</span>
          </div>
          <div className="stat">
            <span className="stat-value">{snapshot.stats.videosLoaded}</span>
            <span className="stat-label">Videos</span>
          </div>
          <div className="stat">
            <span className="stat-value">
              {snapshot.stats.streakDays > 0 ? `🔥${snapshot.stats.streakDays}` : '—'}
            </span>
            <span className="stat-label">Streak</span>
          </div>
        </div>
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Leaderboard</h2>
        {!cloud && (
          <p className="user-sub">
            Sign in with Discord (My Rooms) to sync your stats across devices and join the
            leaderboard.
          </p>
        )}
        {cloud && (
          <>
            <div className="insights-sessions">
              {(['friends', 'global'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`source-tab${scope === s ? ' source-tab-active' : ''}`}
                  onClick={() => setScope(s)}
                >
                  {s === 'friends' ? 'Friends' : 'Everyone'}
                </button>
              ))}
            </div>
            <div className="insights-sessions">
              {LEADERBOARD_METRICS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`source-tab${metric === m.id ? ' source-tab-active' : ''}`}
                  onClick={() => setMetric(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {entries.length === 0 && (
              <p className="user-sub">
                {scope === 'friends'
                  ? 'No friends on the board yet — watch a persistent room with someone and you will both show up here.'
                  : 'No shared stats yet.'}
              </p>
            )}
            <ol className="leaderboard-list">
              {entries.map((entry, index) => (
                <li
                  key={`${entry.displayName}-${index}`}
                  className={`leaderboard-row${entry.isSelf ? ' leaderboard-row-self' : ''}`}
                >
                  <span className="leaderboard-rank">#{index + 1}</span>
                  <span className="leaderboard-name">{entry.displayName}</span>
                  <span className="leaderboard-value">
                    {formatMetricValue(metric, entry.value)}
                  </span>
                </li>
              ))}
            </ol>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => setShareStats(e.target.checked)}
              />
              <span>
                Show me on the leaderboard
                <span className="toggle-hint">
                  {' '}
                  — shares your Discord name and stats, and records which persistent rooms you
                  watch in so friends can rank together. Never what you watch.
                </span>
              </span>
            </label>
          </>
        )}
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Achievements</h2>
        <ul className="achievement-grid">
          {ACHIEVEMENTS.map((achievement) => {
            const isUnlocked = unlocked.has(achievement.id);
            return (
              <li
                key={achievement.id}
                className={`achievement${isUnlocked ? ' achievement-unlocked' : ''}`}
                title={achievement.description}
              >
                <span className="achievement-emoji">{isUnlocked ? achievement.emoji : '🔒'}</span>
                <span className="achievement-title">{achievement.title}</span>
                <span className="achievement-desc">{achievement.description}</span>
              </li>
            );
          })}
        </ul>
        <p className="user-sub">
          {cloud ? 'Synced across your devices.' : 'Stored on this device only.'}
        </p>
      </section>
    </div>
  );
}
