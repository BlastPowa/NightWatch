import { useEffect, useRef, useState } from 'react';
import { sessionRecorder } from '@/lib/analytics/SessionRecorder';
import { ChatPanel } from '@/components/ChatPanel';
import { PlayerPanel } from '@/components/PlayerPanel';
import { QueuePanel } from '@/components/QueuePanel';
import { useQueue } from '@/hooks/useQueue';
import type { RoomService, RoomState } from '@/lib/room/RoomService';
import type { RoomMeta } from '@/lib/rooms/PersistentRoomService';
import { Icon } from '@/components/Icon';

interface RoomScreenProps {
  room: RoomState;
  service: RoomService;
  selfId: string;
  /** Persistent-room metadata (name/schedule), null for ephemeral rooms. */
  meta: RoomMeta | null;
  /** A video picked on the Discover page, to play or queue on arrival. */
  pendingVideo: { videoId: string; title: string; mode: 'play' | 'queue'; positionSeconds?: number } | null;
  onPendingHandled(): void;
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
  pendingVideo,
  onPendingHandled,
  onLeave,
}: RoomScreenProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const self = room.members.find((member) => member.id === selfId);
  const selfIsHost = self?.isHost ?? false;
  const queue = useQueue(service, selfIsHost);
  const loadVideoRef = useRef<((videoId: string, startSeconds?: number) => void) | null>(null);

  // Opt-in session insights (Phase 17, ADR-014): record only while this
  // client is host AND the room owner enabled insights.
  useEffect(() => {
    sessionRecorder.configure(room.code, meta?.insightsEnabled ?? false, selfIsHost);
  }, [room.code, meta, selfIsHost]);

  useEffect(() => {
    return () => sessionRecorder.end();
  }, []);

  useEffect(() => {
    if (room.members.length > 0) {
      sessionRecorder.members(room.members.length);
    }
  }, [room.members.length]);

  // Premiere countdown (Phase 17): tick every 30s while scheduled ahead.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const scheduledMs =
    meta !== null && meta.scheduledAt !== null ? Date.parse(meta.scheduledAt) : null;
  const premiereReady =
    scheduledMs !== null && scheduledMs <= now && meta?.premiereVideoId != null;
  const countdownMinutes =
    scheduledMs !== null && scheduledMs > now
      ? Math.ceil((scheduledMs - now) / 60_000)
      : null;

  // Apply a Discover-page pick once the player loader is mounted (poll
  // briefly — the child registers its loader in its own mount effect).
  useEffect(() => {
    if (pendingVideo === null) {
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (pendingVideo.mode === 'queue') {
        window.clearInterval(timer);
        queue.add(pendingVideo.videoId, pendingVideo.title, self?.displayName ?? 'Me');
        onPendingHandled();
        return;
      }
      if (loadVideoRef.current !== null) {
        window.clearInterval(timer);
        loadVideoRef.current(pendingVideo.videoId, pendingVideo.positionSeconds);
        onPendingHandled();
      } else if (attempts > 20) {
        window.clearInterval(timer);
        onPendingHandled();
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVideo]);

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
        {meta !== null && (
          <span className="room-persistent">
            {meta.name}
            {countdownMinutes !== null && (
              <span className="room-schedule">
                {' '}
                · Premiere in{' '}
                {countdownMinutes >= 60
                  ? `${Math.floor(countdownMinutes / 60)}h ${countdownMinutes % 60}m`
                  : `${countdownMinutes}m`}
              </span>
            )}
            {countdownMinutes === null && meta.scheduledAt !== null && !premiereReady && (
              <span className="room-schedule">
                {' '}
                · Scheduled {formatScheduleBanner(meta.scheduledAt)}
              </span>
            )}
            {meta.insightsEnabled && (
              <span className="room-insights-note" title="The room owner enabled session insights (anonymous counts only — never chat content)">
                {' '}
                · Session insights on
              </span>
            )}
          </span>
        )}
        {premiereReady && selfIsHost && meta?.premiereVideoId != null && (
          <button
            type="button"
            className="button button-glow"
            onClick={() => loadVideoRef.current?.(meta.premiereVideoId as string)}
          >
            <Icon name="play" size={16} /> Start the premiere
          </button>
        )}
        <span className={`room-status room-status-${room.status}`}>
          <span className="status-dot" aria-hidden="true" />
          {STATUS_TEXT[room.status]}
        </span>
      </header>

      <div className="room-body">
        <div className="room-main card">
          <div className="watch-stage-heading">
            <div><span className="eyebrow">Now watching</span><h1>{meta?.name ?? 'Your watch party'}</h1></div>
            <span className={`watch-role${selfIsHost ? ' watch-role-host' : ''}`}>{selfIsHost ? 'Host controls' : 'Watching in sync'}</span>
          </div>
          <PlayerPanel
            service={service}
            isHost={selfIsHost}
            roomCode={room.code}
            allowRoomMomentNotes={meta !== null}
            takeNextFromQueue={queue.popNext}
            exposeLoadVideo={(loader) => {
              loadVideoRef.current = loader;
            }}
          />

          <details className="room-module room-collapsible" open>
          <summary><span><span className="eyebrow">Playlist</span><strong>Up next</strong></span><span aria-hidden="true">⌄</span></summary>
          <QueuePanel
            queue={queue}
            selfId={selfId}
            selfName={self?.displayName ?? 'Me'}
            isHost={selfIsHost}
            onPlayNext={handlePlayNext}
          />
          </details>
        </div>

        <aside className="room-aside card room-dock">
          <div className="room-dock-heading"><div><span className="eyebrow">Watch party</span><h2>Conversation</h2></div><span className="member-count">{room.members.length}</span></div>
          <ChatPanel service={service} members={room.members} selfName={self?.displayName ?? 'Me'} />

          <details className="members-collapsible" open><summary><span>Watching now</span><span aria-hidden="true">⌄</span></summary>
          <ul className="member-list">
            {room.members.map((member) => (
              <li key={member.id} className="member">
                <span className="member-avatar" aria-hidden="true">
                  {member.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="member-name">
                  {member.displayName}
                  {member.id === selfId && <span className="member-you"> (you)</span>}
                  {member.streakDays >= 3 && (
                    <span
                      className="member-streak"
                      title={`${member.streakDays}-day watch streak`}
                    >
                      {' '}
                      🔥{member.streakDays}
                    </span>
                  )}
                </span>
                {member.isHost && <span className="member-host">HOST</span>}
              </li>
            ))}
            {room.members.length === 0 && (
              <li className="member member-empty">Waiting for presence…</li>
            )}
          </ul>
          </details>

          <button type="button" className="button" onClick={onLeave}>
            Leave Room
          </button>
        </aside>
      </div>
    </section>
  );
}
