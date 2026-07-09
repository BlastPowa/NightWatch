import { useSyncExternalStore } from 'react';
import { ACHIEVEMENTS, achievementTracker } from '@/lib/engagement/AchievementTracker';

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
        </div>
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
        <p className="user-sub">Stored on this device only.</p>
      </section>
    </div>
  );
}
