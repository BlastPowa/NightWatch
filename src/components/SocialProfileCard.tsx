import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { getSocialProfile, type SocialProfile } from '@/lib/social/SocialProfileService';
import { blockUser } from '@/lib/social/FriendService';

/**
 * A person's profile (0020). Every field here is one the server decided you may
 * see — an absent field is a refusal, not a gap to fill in.
 *
 * So: when `stats` is missing we say nothing. We do NOT render "0 hours
 * watched", which would be a lie about a person rather than an absence of data.
 */

interface SocialProfileCardProps {
  userId: string;
  onClose(): void;
  onMessage(userId: string): void;
}

function hours(seconds: number): string {
  const total = Math.floor(seconds / 3600);
  return total < 1 ? '<1 hour' : `${total} ${total === 1 ? 'hour' : 'hours'}`;
}

export function SocialProfileCard({
  userId,
  onClose,
  onMessage,
}: SocialProfileCardProps): JSX.Element {
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setMessage(null);
    void getSocialProfile(userId).then((result) => {
      if (!active) {
        return;
      }
      if (result.status === 'ok') {
        setProfile(result.data);
      } else if (result.status === 'blocked') {
        // A blocked user has no profile at all — not an empty one. Saying "no
        // profile" is the honest answer; inventing a shell would imply there is
        // something there to see.
        setMessage('You cannot view this profile.');
      } else {
        setMessage('This profile could not be loaded.');
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  async function block(): Promise<void> {
    setBusy(true);
    const result = await blockUser(userId);
    setBusy(false);
    setMessage(result.status === 'ok' ? 'Blocked.' : 'They could not be blocked.');
    if (result.status === 'ok') {
      onClose();
    }
  }

  return (
    <div className="profile-card" role="dialog" aria-label="Profile">
      <button type="button" className="profile-card-close" onClick={onClose} aria-label="Close profile">
        ×
      </button>

      {profile === null ? (
        <p className="profile-card-empty">{message ?? 'Loading…'}</p>
      ) : (
        <>
          <header className="profile-card-head">
            <ProfileAvatar
              name={profile.displayName}
              src={profile.avatarUrl}
              className={
                profile.selectedBorderId !== null
                  ? `profile-card-avatar border-${profile.selectedBorderId}`
                  : 'profile-card-avatar'
              }
            />
            <div>
              <h3>{profile.displayName}</h3>
              <small>{profile.isFriend ? 'Friend' : profile.isSelf ? 'You' : 'Not connected'}</small>
            </div>
          </header>

          {profile.stats !== undefined && (
            <ul className="profile-card-stats">
              <li>
                <strong>{profile.stats.roomsJoined}</strong>
                <span>rooms</span>
              </li>
              <li>
                <strong>{hours(profile.stats.watchSeconds)}</strong>
                <span>watched</span>
              </li>
              <li>
                <strong>{profile.stats.streakDays}</strong>
                <span>day streak</span>
              </li>
            </ul>
          )}

          {profile.achievements !== undefined && profile.achievements.length > 0 && (
            <section className="profile-card-section">
              <h4>Achievements</h4>
              <ul className="profile-card-achievements">
                {profile.achievements.map((achievement) => (
                  <li key={achievement.id}>
                    <Icon name="check" size={13} />
                    {achievement.id}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.mutualRooms !== undefined && profile.mutualRooms.length > 0 && (
            <section className="profile-card-section">
              <h4>Rooms you share</h4>
              <ul className="profile-card-rooms">
                {profile.mutualRooms.map((room) => (
                  <li key={room.code}>{room.name}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Nothing is rendered for stats/achievements a person did not share.
              An empty state here would tell you something they chose not to. */}

          <footer className="profile-card-actions">
            {profile.canMessage && !profile.isSelf && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => onMessage(profile.userId)}
              >
                Message
              </button>
            )}
            {!profile.isSelf && (
              <button type="button" className="button" disabled={busy} onClick={() => void block()}>
                Block
              </button>
            )}
          </footer>

          {message !== null && <p className="profile-card-empty">{message}</p>}
        </>
      )}
    </div>
  );
}
