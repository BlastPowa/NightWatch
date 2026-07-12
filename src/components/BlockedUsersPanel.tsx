import { useCallback, useEffect, useState } from 'react';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { unblockUser } from '@/lib/social/FriendService';
import { listBlockedUsers, type BlockedUser } from '@/lib/social/SocialProfileService';

/**
 * Block management (0020).
 *
 * The list comes from the server, never from a client-side shadow copy: a local
 * list is already wrong the moment the user blocks someone on another device,
 * and "I cannot see who I blocked" is how a block quietly stops being trusted.
 */
export function BlockedUsersPanel(): JSX.Element {
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await listBlockedUsers();
    setBlocked(result.status === 'ok' ? result.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(user: BlockedUser): Promise<void> {
    setBusyId(user.userId);
    const result = await unblockUser(user.userId);
    setBusyId(null);
    if (result.status === 'ok') {
      setBlocked((current) => current.filter((item) => item.userId !== user.userId));
    }
  }

  if (loading) {
    return <p className="relation-empty">Loading…</p>;
  }

  if (blocked.length === 0) {
    return <p className="relation-empty">You have not blocked anyone.</p>;
  }

  return (
    <ul className="relation-list">
      {blocked.map((user) => (
        <li key={user.userId} className="relation-row">
          <ProfileAvatar name={user.displayName} src={user.avatarUrl} className="person-avatar" />
          <div className="relation-copy">
            <strong>{user.displayName}</strong>
            <small>Blocked {new Date(user.blockedAt).toLocaleDateString()}</small>
          </div>
          <button
            type="button"
            className="button"
            disabled={busyId === user.userId}
            onClick={() => void unblock(user)}
          >
            Unblock
          </button>
        </li>
      ))}
    </ul>
  );
}
