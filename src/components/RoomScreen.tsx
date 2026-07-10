import { useRef, useState } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { PlayerPanel } from '@/components/PlayerPanel';
import { QueuePanel } from '@/components/QueuePanel';
import { useQueue } from '@/hooks/useQueue';
import type { RoomService, RoomState } from '@/lib/room/RoomService';
import type { RoomMeta } from '@/lib/rooms/PersistentRoomService';

interface RoomScreenProps {
  room: RoomState;
  service: RoomService;
  selfId: string;
  /** Persistent-room metadata (name/schedule), null for ephemeral rooms. */
  meta: RoomMeta | null;
  onLeave(): void;
}

function formatScheduleBanner(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_TEXT: Record<RoomState['status'], string> = {
  joining: 'Joining room…',
  joined: 'In room',
  reconnecting: 'Reconnecting…',
  error: 'Could not join the room',
  left: 'Left room',
};

export function RoomScreen({
  room,
  service,
  selfId,
  meta,
  onLeave,
}: RoomScreenProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const self = room.members.find((member) => member.id === selfId);
  const selfIsHost = self?.isHost ?? false;
  const queue = useQueue(service, selfIsHost);
  const loadVideoRef = useRef<((videoId: string) => void) | null>(null);

  function handlePlayNext(): void {
    const next = queue.popNext();
    if (next !== null) {
      loadVideoRef.current?.(next.videoId);
    }
  }

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
    <section className="room-view fade-up">
      <header className="room-header card">
        <div className="room-heading">
          <span className="eyebrow">Watch party</span>
          <button
            type="button"
            className="room-code"
            onClick={copyCode}
            title="Copy room code"
            aria-label={`Copy room code ${room.code}`}
          >
            {room.code}
            <span className="room-code-hint">{copied ? 'Copied!' : 'copy'}</span>
          </button>
        </div>
        <span className={`room-status room-status-${room.status}`}>
          <span className="status-dot" aria-hidden="true" />
          {STATUS_TEXT[room.status]}
        </span>
        <button type="button" className="room-code" onClick={copyCode} title="Click to copy">
          {room.code}
          <span className="room-code-hint">{copied ? 'Copied!' : 'copy'}</span>
        </button>
        {meta !== null && (
          <span className="room-persistent">
            {meta.name}
            {meta.scheduledAt !== null && (
              <span className="room-schedule">
                {' '}
                · Scheduled {formatScheduleBanner(meta.scheduledAt)}
              </span>
            )}
          </span>
        )}
        <span className="room-status">{STATUS_TEXT[room.status]}</span>
      </header>

      <div className="room-body">
        <div className="room-main card">
          <PlayerPanel
            service={service}
            isHost={selfIsHost}
            roomCode={room.code}
            selfId={selfId}
            takeNextFromQueue={queue.popNext}
            exposeLoadVideo={(loader) => {
              loadVideoRef.current = loader;
            }}
          />

          <QueuePanel
            queue={queue}
            selfId={selfId}
            selfName={self?.displayName ?? 'Me'}
            isHost={selfIsHost}
            onPlayNext={handlePlayNext}
          />
        </div>

        <aside className="room-aside card">
          <ChatPanel service={service} members={room.members} selfName={self?.displayName ?? 'Me'} />

          <ul className="member-list">
            {room.members.map((member) => (
              <li key={member.id} className="member">
                <span className="member-avatar" aria-hidden="true">
                  {member.displayName.slice(0, 1).toUpperCase()}
                </span>
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
