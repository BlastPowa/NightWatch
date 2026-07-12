import { useCallback, useEffect, useState } from 'react';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import {
  listRoomInvites,
  respondToRoomInvite,
  type RoomInvite,
} from '@/lib/social/SocialProfileService';

/**
 * Invitations from friends to their persistent rooms (0020).
 *
 * An invitation is a request, not access: accepting is what grants it. Expired
 * invitations never arrive here — the server drops them, because a standing
 * invitation that never expires is a permanent key handed out and forgotten.
 */

interface RoomInvitesPanelProps {
  /** Join the room once the invitation is accepted. */
  onJoin(roomCode: string): void;
}

function expiryLabel(expiresAt: string): string {
  const days = Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) {
    return '';
  }
  return days <= 1 ? 'Expires today' : `Expires in ${days} days`;
}

export function RoomInvitesPanel({ onJoin }: RoomInvitesPanelProps): JSX.Element | null {
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await listRoomInvites();
    setInvites(result.status === 'ok' ? result.data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(invite: RoomInvite, accept: boolean): Promise<void> {
    setBusyId(invite.id);
    const result = await respondToRoomInvite(invite.id, accept);
    setBusyId(null);
    if (result.status !== 'ok') {
      return;
    }
    setInvites((current) => current.filter((item) => item.id !== invite.id));
    if (accept) {
      onJoin(invite.roomCode);
    }
  }

  // Nothing to answer: show nothing rather than an empty box on the page.
  if (invites.length === 0) {
    return null;
  }

  return (
    <section className="room-invites">
      <h3 className="settings-heading">Invitations</h3>
      <ul className="relation-list">
        {invites.map((invite) => (
          <li key={invite.id} className="relation-row">
            <ProfileAvatar
              name={invite.inviterName}
              src={invite.inviterAvatar}
              className="person-avatar"
            />
            <div className="relation-copy">
              <strong>{invite.roomName}</strong>
              <small>
                From {invite.inviterName} · {expiryLabel(invite.expiresAt)}
              </small>
            </div>
            <div className="relation-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busyId === invite.id}
                onClick={() => void respond(invite, true)}
              >
                Accept
              </button>
              <button
                type="button"
                className="button"
                disabled={busyId === invite.id}
                onClick={() => void respond(invite, false)}
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
