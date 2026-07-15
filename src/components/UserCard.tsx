import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AuthUser } from '@/lib/auth';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { listBorders, selectBorder, unlockBorder, type ProfileBorder } from '@/lib/social/ProfileService';
import { ACHIEVEMENTS, achievementTracker } from '@/lib/engagement/AchievementTracker';
import { getCloudSyncState, setShareStats, subscribeCloudSync } from '@/lib/engagement/CloudSync';
import {
  getLeaderboard,
  LEADERBOARD_METRICS,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardScope,
} from '@/lib/engagement/LeaderboardService';
import '@/styles/phase26-social.css';

type ProfileTab = 'overview' | 'achievements';

function formatMetricValue(metric: LeaderboardMetric, value: number): string {
  if (metric === 'watch_seconds') {
    return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  }
  if (metric === 'streak_days') return `${value} days`;
  return String(value);
}

function formatWatchTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

interface UserCardProps {
  displayName: string;
  user: AuthUser | null;
}

/** Local engagement profile. Stats are device-local unless cloud sync is active. */
export function UserCard({ displayName, user }: UserCardProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    (onChange) => achievementTracker.subscribe(onChange),
    () => achievementTracker.get(),
  );
  const unlocked = new Set(snapshot.unlockedIds);
  const { synced: cloud, shareStats: share } = useSyncExternalStore(
    subscribeCloudSync,
    getCloudSyncState,
  );
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [metric, setMetric] = useState<LeaderboardMetric>('watch_seconds');
  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [borders, setBorders] = useState<ProfileBorder[]>([]);
  const [borderState, setBorderState] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');

  const safeName = displayName.trim() || 'Anonymous';
  const selectedBorderId = borders.find((border) => border.selected)?.id ?? 'default';

  useEffect(() => {
    if (user === null) {
      setBorders([]);
      return;
    }
    let active = true;
    setBorderState('loading');
    const borderIds = snapshot.unlockedIds.map((id) => id === 'first-night' ? 'first-room' : id);
    void Promise.all(borderIds.map((id) => unlockBorder(id)))
      .then(() => listBorders())
      .then((result) => {
        if (!active) return;
        if (result.status === 'ok') {
          setBorders(result.data);
          setBorderState('idle');
        } else {
          setBorderState('error');
        }
      });
    return () => { active = false; };
  }, [user, snapshot.unlockedIds]);

  useEffect(() => {
    if (!cloud) {
      setEntries([]);
      return;
    }
    let active = true;
    void getLeaderboard(metric, scope).then((rows) => {
      if (active) setEntries(rows);
    });
    return () => { active = false; };
  }, [cloud, metric, scope]);

  async function chooseBorder(border: ProfileBorder): Promise<void> {
    if (!border.unlocked || border.selected) return;
    setBorderState('saving');
    const result = await selectBorder(border.id);
    if (result.status === 'ok') {
      setBorders((current) => current.map((item) => ({ ...item, selected: item.id === border.id })));
      setBorderState('idle');
    } else {
      setBorderState('error');
    }
  }

  return (
    <div className="settings-page user-card-page phase26-profile-page fade-up">
      <section className="profile-banner" aria-labelledby="profile-title">
        <div className="profile-banner-art" aria-hidden="true"><span /><span /></div>
        <div className="profile-banner-content">
          <span className={`profile-border-preview profile-border-${selectedBorderId}`}>
            <ProfileAvatar src={user?.avatarUrl ?? null} name={safeName} className="user-avatar" />
          </span>
          <div className="profile-banner-copy">
            <span className="eyebrow">NightWatch profile</span>
            <h1 id="profile-title">{safeName}</h1>
            <p>{snapshot.unlockedIds.length}/{ACHIEVEMENTS.length} achievements · {cloud ? 'Synced across devices' : 'Stored on this device'}</p>
          </div>
        </div>
      </section>

      <nav className="profile-tabs" aria-label="Profile sections" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === 'overview'} aria-controls="profile-overview" className={activeTab === 'overview' ? 'profile-tab-active' : ''} onClick={() => setActiveTab('overview')}>Overview</button>
        <button type="button" role="tab" aria-selected={activeTab === 'achievements'} aria-controls="profile-achievements" className={activeTab === 'achievements' ? 'profile-tab-active' : ''} onClick={() => setActiveTab('achievements')}>Achievements</button>
      </nav>

      {activeTab === 'overview' && (
        <div id="profile-overview" role="tabpanel" className="profile-overview-grid">
          <section className="card user-card profile-stat-card" aria-labelledby="profile-stats-title">
            <div className="section-heading-row"><div><span className="eyebrow">Activity snapshot</span><h2 id="profile-stats-title">Your watch rhythm</h2></div><span className="profile-data-label">{cloud ? 'Cloud synced' : 'Device only'}</span></div>
            <div className="stat-grid">
              <div className="stat"><span className="stat-value">{snapshot.stats.roomsJoined}</span><span className="stat-label">Rooms</span></div>
              <div className="stat"><span className="stat-value">{formatWatchTime(snapshot.stats.watchSeconds)}</span><span className="stat-label">Watched</span></div>
              <div className="stat"><span className="stat-value">{snapshot.stats.reactionsSent}</span><span className="stat-label">Reactions</span></div>
              <div className="stat"><span className="stat-value">{snapshot.stats.chatsSent}</span><span className="stat-label">Messages</span></div>
              <div className="stat"><span className="stat-value">{snapshot.stats.videosLoaded}</span><span className="stat-label">Videos</span></div>
              <div className="stat"><span className="stat-value">{snapshot.stats.streakDays > 0 ? snapshot.stats.streakDays : '—'}</span><span className="stat-label">Day streak</span></div>
            </div>
          </section>

          <section className="card settings-card leaderboard-card">
            <div className="section-heading-row"><div><span className="eyebrow">Community</span><h2 className="settings-heading">Leaderboard</h2></div></div>
            {!cloud ? (
              <p className="user-sub">Sign in with Discord from My Rooms to sync your stats and join the leaderboard.</p>
            ) : (
              <>
                <div className="profile-filter-row" aria-label="Leaderboard scope">
                  {(['friends', 'global'] as const).map((item) => <button key={item} type="button" className={`source-tab${scope === item ? ' source-tab-active' : ''}`} aria-pressed={scope === item} onClick={() => setScope(item)}>{item === 'friends' ? 'Friends' : 'Everyone'}</button>)}
                </div>
                <div className="profile-filter-row" aria-label="Leaderboard metric">
                  {LEADERBOARD_METRICS.map((item) => <button key={item.id} type="button" className={`source-tab${metric === item.id ? ' source-tab-active' : ''}`} aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}
                </div>
                {entries.length === 0 ? <p className="user-sub">{scope === 'friends' ? 'No friends are sharing this stat yet.' : 'No shared stats yet.'}</p> : (
                  <ol className="leaderboard-list">
                    {entries.map((entry, index) => <li key={`${entry.displayName}-${index}`} className={`leaderboard-row${entry.isSelf ? ' leaderboard-row-self' : ''}`}><span className="leaderboard-rank">#{index + 1}</span><span className="leaderboard-name">{entry.displayName}</span><span className="leaderboard-value">{formatMetricValue(metric, entry.value)}</span></li>)}
                  </ol>
                )}
                <label className="toggle-row"><input type="checkbox" checked={share} onChange={(event) => setShareStats(event.target.checked)} /><span>Show me on the leaderboard<span className="toggle-hint"> — shares your Discord name and stats, never what you watch.</span></span></label>
              </>
            )}
          </section>
        </div>
      )}

      {activeTab === 'achievements' && (
        <div id="profile-achievements" role="tabpanel" className="profile-achievement-layout">
          {user !== null && (
            <section className="card settings-card profile-cosmetics">
              <div className="section-heading-row"><div><span className="eyebrow">Profile studio</span><h2 className="settings-heading">Achievement borders</h2><p className="user-sub">Choose any border you have earned. Selection is validated by the server.</p></div><span className="settings-sync-state">{borderState === 'loading' ? 'Loading…' : borderState === 'saving' ? 'Saving…' : borderState === 'error' ? 'Could not sync' : `${borders.filter((border) => border.unlocked).length} unlocked`}</span></div>
              <div className="profile-border-grid">
                {borders.map((border) => <button key={border.id} type="button" className={`profile-border-tile${border.selected ? ' profile-border-tile-active' : ''}`} disabled={!border.unlocked || borderState === 'saving'} onClick={() => void chooseBorder(border)} aria-pressed={border.selected}><span className={`profile-border-sample profile-border-${border.id}`}><ProfileAvatar src={user.avatarUrl} name={safeName} /></span><span><strong>{border.label}</strong><small>{border.selected ? 'Selected' : border.unlocked ? 'Unlocked' : 'Keep watching to unlock'}</small></span></button>)}
              </div>
            </section>
          )}
          <section className="card settings-card achievements-card">
            <div className="section-heading-row"><div><span className="eyebrow">Milestones</span><h2 className="settings-heading">Achievements</h2></div><span className="profile-data-label">{snapshot.unlockedIds.length}/{ACHIEVEMENTS.length}</span></div>
            <ul className="achievement-grid">
              {ACHIEVEMENTS.map((achievement) => {
                const isUnlocked = unlocked.has(achievement.id);
                return <li key={achievement.id} className={`achievement${isUnlocked ? ' achievement-unlocked' : ''}`} title={achievement.description}><span className="achievement-emoji">{isUnlocked ? achievement.emoji : 'Locked'}</span><span className="achievement-title">{achievement.title}</span><span className="achievement-desc">{achievement.description}</span></li>;
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
