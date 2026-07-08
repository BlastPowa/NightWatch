import { useState } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { PlayerPanel } from '@/components/PlayerPanel';
import type { RoomService, RoomState } from '@/lib/room/RoomService';

interface RoomScreenProps {
  room: RoomState;
  service: RoomService;
  selfId: string;
  onLeave(): void;
}

const STATUS_TEXT: Record<RoomState['status'], string> = {
  joining: 'Joining room…',
  joined: 'In room',
  reconnecting: 'Reconnecting…',
  error: 'Could not join the room',
  left: 'Left room',
};

export function RoomScreen({ room, service, selfId, onLeave }: RoomScreenProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const self = room.members.find((member) => member.id === selfId);
  const selfIsHost = self?.isHost ?? false;

  function copyCode(): void {
    navigator.clipboard
      .writeText(room.code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard unavailable (e.g. file:// context) — code stays visible.
      });
  }

  return (
    <section className="panel panel-wide">
      <header className="room-header">
        <button type="button" className="room-code" onClick={copyCode} title="Click to copy">
          {room.code}
          <span className="room-code-hint">{copied ? 'Copied!' : 'copy'}</span>
        </button>
        <span className="room-status">{STATUS_TEXT[room.status]}</span>
      </header>

      <div className="room-body">
        <div className="room-main">
          <PlayerPanel service={service} isHost={selfIsHost} />
        </div>

        <aside className="room-aside">
          <ChatPanel service={service} members={room.members} selfName={self?.displayName ?? 'Me'} />

          <ul className="member-list">
            {room.members.map((member) => (
              <li key={member.id} className="member">
                <span className="member-name">
                  {member.displayName}
                  {member.id === selfId && <span className="member-you"> (you)</span>}
                </span>
                {member.isHost && <span className="member-host">HOST</span>}
              </li>
            ))}
            {room.members.length === 0 && (
              <li className="member member-empty">Waiting for presence…</li>
            )}
          </ul>

          <button type="button" className="button" onClick={onLeave}>
            Leave Room
          </button>
        </aside>
      </div>
    </section>
  );
}
