import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import {
  getFriendMediaPresence,
  type FriendMediaPresence,
} from '@/lib/social/PresenceService';

interface FriendActivityDrawerProps {
  open: boolean;
  onClose(): void;
  onOpenFriends(): void;
}

const STATUS_ORDER: Record<FriendMediaPresence['status'], number> = {
  in_party: 0,
  watching: 1,
  online: 2,
  offline: 3,
};

function statusCopy(friend: FriendMediaPresence): string {
  if (friend.status === 'in_party') return 'In a watch party';
  if (friend.status === 'watching') return friend.videoTitle ?? 'Watching now';
  if (friend.status === 'online') return 'Online';
  return 'Offline';
}

export function FriendActivityDrawer({ open, onClose, onOpenFriends }: FriendActivityDrawerProps): JSX.Element | null {
  const [friends, setFriends] = useState<FriendMediaPresence[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = (): void => {
      setLoading(true);
      void getFriendMediaPresence().then((result) => {
        if (!active) return;
        setLoading(false);
        if (result.status === 'ok') {
          setFriends(result.data);
          setMessage(null);
        } else {
          setMessage(result.status === 'offline' ? 'Friend activity is offline.' : 'Friend activity could not be loaded.');
        }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [open]);

  const ordered = useMemo(
    () => [...friends].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.displayName.localeCompare(b.displayName)),
    [friends],
  );

  if (!open) return null;
  return (
    <aside className="friend-activity-drawer" aria-label="Friend activity">
      <header>
        <div><span className="eyebrow">Your circle</span><h2>Friend activity</h2></div>
        <button type="button" className="topbar-icon" onClick={onClose} aria-label="Close friend activity"><Icon name="close" size={16} /></button>
      </header>
      <div className="friend-activity-list">
        {loading && friends.length === 0 && <div className="friend-activity-empty"><span className="loader-orbit" />Checking activity…</div>}
        {message !== null && <p className="friend-activity-empty" role="status">{message}</p>}
        {!loading && message === null && ordered.length === 0 && <p className="friend-activity-empty">No accepted friends are sharing presence yet.</p>}
        {ordered.map((friend) => (
          <article key={friend.userId} className={`friend-activity-card friend-activity-${friend.status}`}>
            <span className="friend-activity-avatar">
              <ProfileAvatar src={friend.avatarUrl} name={friend.displayName} className={friend.selectedBorderId ? `border-${friend.selectedBorderId}` : ''} />
              <i className={`presence-dot presence-${friend.status}`} aria-hidden="true" />
            </span>
            <span><strong>{friend.displayName}</strong><small>{statusCopy(friend)}</small></span>
          </article>
        ))}
      </div>
      <button type="button" className="button button-primary friend-activity-manage" onClick={onOpenFriends}><Icon name="friends" size={16} />Manage friends</button>
    </aside>
  );
}
