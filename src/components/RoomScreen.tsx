import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { sessionRecorder } from '@/lib/analytics/SessionRecorder';
import { ChatPanel } from '@/components/ChatPanel';
import { PlayerPanel } from '@/components/PlayerPanel';
import { QueuePanel } from '@/components/QueuePanel';
import { SearchBox } from '@/components/SearchBox';
import { useQueue } from '@/hooks/useQueue';
import type { RoomService, RoomState } from '@/lib/room/RoomService';
import type { RoomMeta } from '@/lib/rooms/PersistentRoomService';
import { Icon } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { MovieWatchPanel } from '@/components/MovieWatchPanel';
import type { MediaPlatformBridge } from '@shared/mediaBridge';
import { buildInviteTokenLink, mintRoomInvite, revokeRoomInvite, type RoomInviteToken } from '@/lib/room/InviteTokenService';
import { getRoomPeople, type PublicPerson } from '@/lib/people/PeopleService';
import { sendFriendRequest } from '@/lib/social/FriendService';

interface RoomScreenProps {
  room: RoomState;
  service: RoomService;
  selfId: string;
  presentation: 'full' | 'mini' | 'hidden';
  /** Persistent-room metadata (name/schedule), null for ephemeral rooms. */
  meta: RoomMeta | null;
  /** A video picked on the Discover page, to play or queue on arrival. */
  pendingVideo: { videoId: string; title: string; mode: 'play' | 'queue'; positionSeconds?: number } | null;
  onPendingHandled(): void;
  onMediaStateChange(hasVideo: boolean): void;
  mediaBridge?: MediaPlatformBridge | null;
  htmlMediaAvailable?: boolean;
  onReturnToRoom(): void;
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
  presentation,
  meta,
  pendingVideo,
  onPendingHandled,
  onMediaStateChange,
  mediaBridge = null,
  htmlMediaAvailable = false,
  onReturnToRoom,
  onLeave,
}: RoomScreenProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [dockTab, setDockTab] = useState<'queue' | 'chat' | 'people' | 'moments' | 'discovery'>('queue');
  const [miniCollapsed, setMiniCollapsed] = useState(false);
  const [miniPosition, setMiniPosition] = useState<{ left: number; top: number } | null>(null);
  const [watchMode, setWatchMode] = useState<'youtube' | 'movie'>('youtube');
  const roomViewRef = useRef<HTMLElement | null>(null);
  const self = room.members.find((member) => member.id === selfId);
  const selfIsHost = self?.isHost ?? false;
  const queue = useQueue(service, selfIsHost);
  const loadVideoRef = useRef<((videoId: string, startSeconds?: number) => void) | null>(null);
  const knownMemberIdsRef = useRef<Set<string> | null>(null);
  const [joinNotice, setJoinNotice] = useState<RoomState['members'][number] | null>(null);
  const [roomInvite, setRoomInvite] = useState<RoomInviteToken | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [roomPeople, setRoomPeople] = useState<PublicPerson[]>([]);
  const [roomPeopleLoading, setRoomPeopleLoading] = useState(false);
  const [friendActionId, setFriendActionId] = useState<string | null>(null);
  const [friendActionMessage, setFriendActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const currentIds = new Set(room.members.map((member) => member.id));
    if (knownMemberIdsRef.current === null) {
      knownMemberIdsRef.current = currentIds;
      return;
    }
    const joined = room.members.find((member) => member.id !== selfId && !knownMemberIdsRef.current?.has(member.id));
    for (const id of currentIds) knownMemberIdsRef.current.add(id);
    if (joined === undefined) return;
    setJoinNotice(joined);
    playRoomJoinChime();
    const timer = window.setTimeout(() => setJoinNotice((current) => current?.id === joined.id ? null : current), 4_800);
    return () => window.clearTimeout(timer);
  }, [room.members, selfId]);

  useEffect(() => {
    if (dockTab !== 'people') return;
    let active = true;
    setRoomPeopleLoading(true);
    void getRoomPeople(room.code).then((result) => {
      if (!active) return;
      setRoomPeopleLoading(false);
      if (result.ok) setRoomPeople(result.value);
      else setFriendActionMessage(result.message);
    });
    return () => { active = false; };
  }, [dockTab, room.code, room.members.length]);

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
        const field = document.createElement('textarea');
        field.value = room.code;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const didCopy = document.execCommand('copy');
        field.remove();
        if (didCopy) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
        // Clipboard unavailable (e.g. file:// context) — code stays visible.
      });
  }

  async function copySecureInvite(): Promise<void> {
    setInviting(true);
    setInviteStatus(null);
    try {
      if (roomInvite !== null) {
        await navigator.clipboard.writeText(buildInviteTokenLink(roomInvite.token));
        setInviteStatus('Secure invite copied. It can be used once before it expires.');
        return;
      }
      const result = await mintRoomInvite(room.code);
      if (!result.ok) {
        setInviteStatus(result.message);
        return;
      }
      await navigator.clipboard.writeText(buildInviteTokenLink(result.value.token));
      setRoomInvite(result.value);
      setInviteStatus('Secure invite copied. It can be used once before it expires.');
    } catch {
      setInviteStatus('The secure invite was created, but this device could not copy it. Try again from the room.');
    } finally {
      setInviting(false);
    }
  }

  async function revokeSecureInvite(): Promise<void> {
    if (roomInvite === null) return;
    setInviting(true);
    const result = await revokeRoomInvite(roomInvite.token);
    setInviting(false);
    if (!result.ok) {
      setInviteStatus(result.message);
      return;
    }
    setRoomInvite(null);
    setInviteStatus('Secure invite revoked.');
  }

  async function requestRoomFriend(person: PublicPerson): Promise<void> {
    setFriendActionId(person.userId);
    setFriendActionMessage(null);
    const result = await sendFriendRequest(person.userId);
    setFriendActionId(null);
    if (result.status !== 'ok') {
      setFriendActionMessage(friendRequestFailureMessage(result.status));
      return;
    }
    setRoomPeople((current) => current.map((item) => item.userId === person.userId ? { ...item, relationship: 'pending-outgoing' } : item));
    setFriendActionMessage(`Friend request sent to ${person.displayName}.`);
  }

  function openMomentTools(): void {
    const module = document.querySelector<HTMLDetailsElement>('.player-community-module');
    if (module !== null) {
      module.open = true;
      module.scrollIntoView({ behavior: 'smooth', block: 'center' });
      module.querySelector<HTMLElement>('summary')?.focus();
    }
  }

  function startMiniDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (presentation !== 'mini' || (event.target as HTMLElement).closest('button') !== null) return;
    const panel = roomViewRef.current;
    if (panel === null) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    const move = (nextEvent: PointerEvent): void => {
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      setMiniPosition({
        left: Math.min(maxLeft, Math.max(8, startLeft + nextEvent.clientX - startX)),
        top: Math.min(maxTop, Math.max(8, startTop + nextEvent.clientY - startY)),
      });
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }

  useEffect(() => {
    if (presentation !== 'mini' || miniPosition === null) return;
    const clamp = (): void => {
      const panel = roomViewRef.current;
      if (panel === null) return;
      const rect = panel.getBoundingClientRect();
      setMiniPosition((current) => current === null ? null : ({
        left: Math.min(Math.max(8, window.innerWidth - rect.width - 8), Math.max(8, current.left)),
        top: Math.min(Math.max(8, window.innerHeight - rect.height - 8), Math.max(8, current.top)),
      }));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [miniPosition, presentation]);

  return (
    <section
      ref={roomViewRef}
      className={`room-view room-view-${presentation}${presentation === 'mini' && miniCollapsed ? ' room-view-mini-collapsed' : ''}${presentation === 'full' ? ' fade-up' : ''}`}
      style={presentation === 'mini' && miniPosition !== null ? ({ left: miniPosition.left, top: miniPosition.top, right: 'auto', bottom: 'auto' } as CSSProperties) : undefined}
      aria-hidden={presentation === 'hidden' ? true : undefined}
    >
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
        {selfIsHost && room.status === 'joined' && (
          <div className="room-invite-control">
            <button type="button" className="button" disabled={inviting} onClick={() => void copySecureInvite()}>
              <Icon name="send" size={15} /> {inviting ? 'Preparingâ€¦' : roomInvite === null ? 'Copy secure invite' : 'Copy invite again'}
            </button>
            {roomInvite !== null && <button type="button" className="button button-quiet" disabled={inviting} onClick={() => void revokeSecureInvite()}>Revoke</button>}
            {inviteStatus !== null && <span className="room-invite-status" role="status">{inviteStatus}</span>}
          </div>
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
          <div className="watch-mode-tabs" role="tablist" aria-label="Watch source">
            <button type="button" role="tab" aria-selected={watchMode === 'youtube'} className={watchMode === 'youtube' ? 'watch-mode-tab watch-mode-tab-active' : 'watch-mode-tab'} onClick={() => setWatchMode('youtube')}><Icon name="play" size={16} />YouTube Watch</button>
            {mediaBridge !== null && htmlMediaAvailable && <button type="button" role="tab" aria-selected={watchMode === 'movie'} className={watchMode === 'movie' ? 'watch-mode-tab watch-mode-tab-active' : 'watch-mode-tab'} onClick={() => setWatchMode('movie')}><Icon name="film" size={16} />Movie Watch</button>}
          </div>
          {watchMode === 'youtube' && <PlayerPanel
            service={service}
            isHost={selfIsHost}
            roomCode={room.code}
            allowRoomMomentNotes={meta !== null}
            presentation={presentation}
            takeNextFromQueue={queue.popNext}
            onMediaStateChange={onMediaStateChange}
            onReturnToRoom={onReturnToRoom}
            miniCollapsed={miniCollapsed}
            onMiniCollapsedChange={setMiniCollapsed}
            onMiniDragStart={startMiniDrag}
            exposeLoadVideo={(loader) => {
              loadVideoRef.current = loader;
            }}
          />}
          {mediaBridge !== null && <MovieWatchPanel
            roomCode={room.code}
            service={service}
            selfId={selfId}
            hostId={room.hostId}
            isHost={selfIsHost}
            bridge={mediaBridge}
            htmlMediaAvailable={htmlMediaAvailable}
            active={watchMode === 'movie'}
            onModeChange={setWatchMode}
            onHasMediaChange={() => onMediaStateChange(false)}
          />}

        </div>

        <aside className="room-aside card room-dock">
          <div className="room-dock-heading">
            <div><span className="eyebrow">Watch party</span><h2>Room lounge</h2></div>
            <span className="member-count" aria-label={`${room.members.length} watching`}>{room.members.length}</span>
          </div>

          <div
            className="room-dock-tabs"
            role="tablist"
            aria-label="Room companion"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
              if (currentIndex < 0 || tabs.length === 0) return;
              event.preventDefault();
              const direction = event.key === 'ArrowRight' ? 1 : -1;
              const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
              next?.focus();
              next?.click();
            }}
          >
            <DockTab id="queue" label="Up next" icon="play" current={dockTab} onSelect={setDockTab} />
            <DockTab id="chat" label="Chat" icon="message" current={dockTab} onSelect={setDockTab} />
            <DockTab id="people" label="People" icon="users" current={dockTab} onSelect={setDockTab} />
            <DockTab id="moments" label="Moments" icon="clock" current={dockTab} onSelect={setDockTab} />
            <DockTab id="discovery" label="Discover" icon="search" current={dockTab} onSelect={setDockTab} />
          </div>

          <div id={`room-dock-panel-${dockTab}`} className={`room-dock-panel room-dock-${dockTab}`} role="tabpanel" aria-labelledby={`room-dock-tab-${dockTab}`} tabIndex={0}>
            {dockTab === 'queue' && <QueuePanel queue={queue} selfId={selfId} selfName={self?.displayName ?? 'Me'} isHost={selfIsHost} onPlayNext={handlePlayNext} />}
            {dockTab === 'chat' && <div className="room-chat-section"><ChatPanel service={service} members={room.members} selfName={self?.displayName ?? 'Me'} /></div>}
            {dockTab === 'people' && (
              <ul className="member-list">
                {room.members.map((member) => (
                  <li key={member.id} className="member">
                    <ProfileAvatar src={memberAvatarUrl(member)} name={member.displayName} className="member-avatar" />
                    <span className="member-name">
                      {member.displayName}
                      {member.id === selfId && <span className="member-you"> (you)</span>}
                      {member.streakDays >= 3 && (
                        <span className="member-streak" title={`${member.streakDays}-day watch streak`}>
                          {' '}🔥{member.streakDays}
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
            )}
            {dockTab === 'people' && (
              <div className="room-people-actions">
                {roomPeopleLoading && <p className="room-people-hint">Checking signed-in people in this roomâ€¦</p>}
                {!roomPeopleLoading && roomPeople.filter((person) => person.relationship === 'none').map((person) => (
                  <article key={person.userId} className="room-person-request-card">
                    <ProfileAvatar src={person.avatarUrl} name={person.displayName} className="member-avatar" />
                    <div><strong>{person.displayName}</strong><small>{person.handle === null ? 'In this room now' : `@${person.handle}`}</small></div>
                    <button type="button" className="button button-primary" disabled={friendActionId === person.userId} onClick={() => void requestRoomFriend(person)}><Icon name="plus" size={14} />{friendActionId === person.userId ? 'Sendingâ€¦' : 'Add friend'}</button>
                  </article>
                ))}
                {!roomPeopleLoading && roomPeople.some((person) => person.relationship === 'pending-outgoing') && <p className="room-people-hint">Friend request sent — it will appear in their Friends page to accept or decline.</p>}
                {friendActionMessage !== null && <p className="room-people-hint" role="status">{friendActionMessage}</p>}
              </div>
            )}
            {dockTab === 'moments' && <div className="dock-empty-state"><span className="dock-empty-icon"><Icon name="clock" size={24} /></span><strong>Shared moments</strong><p>Reactions and timestamp notes stay below the official player, where they never cover YouTube controls.</p><button type="button" className="button button-glow" onClick={openMomentTools}>Open moment tools</button></div>}
            {dockTab === 'discovery' && (selfIsHost ? <SearchBox callerId={selfId} onSelect={(videoId) => loadVideoRef.current?.(videoId)} /> : <div className="dock-empty-state"><span className="dock-empty-icon"><Icon name="search" size={24} /></span><strong>Host discovery</strong><p>The host chooses what loads next. Add your pick to Up Next so everyone can vote.</p><button type="button" className="button" onClick={() => setDockTab('queue')}>Open queue</button></div>)}
          </div>

          <button type="button" className="button room-leave-button" onClick={onLeave}>
            Leave Room
          </button>
        </aside>
      </div>
      {joinNotice !== null && (
        <aside className="room-join-toast" role="status" aria-live="polite">
          <ProfileAvatar src={memberAvatarUrl(joinNotice)} name={joinNotice.displayName} className="room-join-toast-avatar" />
          <span><strong>{joinNotice.displayName}</strong><small>has joined the room</small></span>
          <button type="button" onClick={() => setJoinNotice(null)} aria-label="Dismiss join notification"><Icon name="close" size={14} /></button>
        </aside>
      )}
    </section>
  );
}

function playRoomJoinChime(): void {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return;
  try {
    const AudioContextConstructor = window.AudioContext;
    const context = new AudioContextConstructor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.48);
    gain.connect(context.destination);
    [659.25, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.11);
      oscillator.stop(context.currentTime + 0.34 + index * 0.11);
    });
    window.setTimeout(() => void context.close(), 650);
  } catch {
    // Browser autoplay/audio policy can reject non-gesture audio. The visual
    // notification remains the reliable contract.
  }
}

type DockTabId = 'queue' | 'chat' | 'people' | 'moments' | 'discovery';

function DockTab({ id, label, icon, current, onSelect }: { id: DockTabId; label: string; icon: 'play' | 'message' | 'users' | 'clock' | 'search'; current: DockTabId; onSelect(value: DockTabId): void }): JSX.Element {
  return <button id={`room-dock-tab-${id}`} type="button" role="tab" aria-selected={current === id} aria-controls={`room-dock-panel-${id}`} tabIndex={current === id ? 0 : -1} className={current === id ? 'room-dock-tab room-dock-tab-active' : 'room-dock-tab'} onClick={() => onSelect(id)}><Icon name={icon} size={17} /><span>{label}</span></button>;
}

function memberAvatarUrl(member: RoomState['members'][number]): string | null {
  return member.avatarUrl ?? null;
}

function friendRequestFailureMessage(status: string): string {
  if (status === 'unauthenticated') return 'Connect Discord to send friend requests.';
  if (status === 'blocked') return 'A friend request cannot be sent for this account.';
  if (status === 'rate-limited') return 'Please wait a moment before sending another request.';
  if (status === 'offline') return 'Friend requests need an internet connection.';
  if (status === 'not-ready') return 'Friends are not available on this server yet.';
  return 'The friend request could not be sent.';
}
