import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomMember } from '@shared/room';
import type { VoiceCapabilityReport } from '@shared/rtc';
import { Icon } from '@/components/Icon';
import {
  explainRoomMediaCapabilities,
  getRoomMediaCapabilities,
  resetRoomMediaCapabilities,
  type CapabilityDisabledReason,
} from '@/lib/media/roomMediaCapabilities';
import { commsLifecycle } from '@/lib/rtc/CommsLifecycle';
import { VoiceSession } from '@/lib/rtc/VoiceSession';
import type { VoiceCoreSnapshot } from '@/lib/rtc/sessionCore';

interface VoicePanelProps {
  roomCode: string;
  selfId: string;
  members: readonly RoomMember[];
  onOpenAccount?(): void;
}

export function VoicePanel({ roomCode, selfId, members, onOpenAccount }: VoicePanelProps): JSX.Element {
  const [capable, setCapable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [disabledReason, setDisabledReason] = useState<CapabilityDisabledReason>('signed-out');
  const [snapshot, setSnapshot] = useState<VoiceCoreSnapshot | null>(null);
  const [capability, setCapability] = useState<VoiceCapabilityReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(() => new Map());
  const sessionRef = useRef<VoiceSession | null>(null);
  const unregisterLifecycleRef = useRef<(() => void) | null>(null);

  const refreshCapability = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      const features = await getRoomMediaCapabilities({ htmlMedia: false, googleDrive: false });
      setCapable(features.voiceChat && VoiceSession.supported());
      setDisabledReason(explainRoomMediaCapabilities({ htmlMedia: false, googleDrive: false }).voiceChat);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void refreshCapability(); }, [refreshCapability]);

  const endVoice = useCallback((): void => {
    const session = sessionRef.current;
    sessionRef.current = null;
    unregisterLifecycleRef.current?.();
    unregisterLifecycleRef.current = null;
    session?.end('left');
    setRemoteStreams(new Map());
    setCapability(null);
  }, []);

  useEffect(() => () => endVoice(), [endVoice]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || snapshot?.phase === 'ended') return;
    for (const member of members) {
      if (member.id !== selfId) void session.connectTo(member.id);
    }
  }, [members, selfId, snapshot?.phase]);

  async function joinVoice(): Promise<void> {
    if (!capable || sessionRef.current !== null) return;
    setMessage(null);
    let session: VoiceSession;
    session = new VoiceSession(roomCode, selfId, {
      onSnapshot: (next) => {
        setSnapshot(next);
        if (next.phase === 'ended' && sessionRef.current === session) {
          sessionRef.current = null;
          unregisterLifecycleRef.current?.();
          unregisterLifecycleRef.current = null;
          setRemoteStreams(new Map());
          setCapability(null);
        }
      },
      onCapability: setCapability,
      onRemoteTrack: (userId, stream) => setRemoteStreams((current) => {
        const next = new Map(current);
        next.set(userId, stream);
        return next;
      }),
      onRemoteTrackEnded: (userId) => setRemoteStreams((current) => {
        const next = new Map(current);
        next.delete(userId);
        return next;
      }),
      onPeerState: () => {},
    });
    sessionRef.current = session;
    unregisterLifecycleRef.current = commsLifecycle.registerVoice(session);
    const started = await session.start();
    if (!started.ok) {
      setMessage(started.message);
      unregisterLifecycleRef.current?.();
      unregisterLifecycleRef.current = null;
      sessionRef.current = null;
      session.end(started.code === 'permission-required' ? 'permission-denied' : 'error');
      return;
    }
    for (const member of members) {
      if (member.id !== selfId) void session.connectTo(member.id);
    }
  }

  async function retryCapability(): Promise<void> {
    resetRoomMediaCapabilities();
    await refreshCapability();
  }

  const active = sessionRef.current !== null && snapshot?.phase !== 'ended';
  const connectedPeers = useMemo(
    () => snapshot?.peers.filter((peer) => peer.connected).length ?? 0,
    [snapshot],
  );
  const unavailableMessage = !VoiceSession.supported()
    ? 'Voice chat needs a secure browser or the packaged Electron app with microphone access.'
    : disabledReason === 'signed-out'
      ? 'Connect a NightWatch account to join room voice.'
      : disabledReason === 'relay-not-configured'
        ? 'Voice is configured, but the TURN relay still needs to be deployed for reliable calls.'
        : disabledReason === 'not-deployed'
          ? 'Voice signaling is not deployed for this NightWatch server yet.'
          : 'Voice chat is unavailable on this platform.';

  return (
    <section className={`room-voice${active ? ' room-voice-active' : ''}`} aria-label="Room voice chat">
      <div className="room-voice-heading">
        <span className="room-voice-icon"><Icon name="headphones" size={17} /></span>
        <span><strong>Voice lounge</strong><small>{active ? `${connectedPeers + 1} in voice` : 'Optional peer-to-peer audio'}</small></span>
        {snapshot?.self.speaking && <span className="room-voice-speaking">Speaking</span>}
      </div>

      {!capable && !active ? (
        <div className="room-voice-unavailable">
          <small>{checking ? 'Checking voice…' : unavailableMessage}</small>
          <div>
            {disabledReason === 'signed-out' && onOpenAccount !== undefined && <button type="button" className="button button-quiet" onClick={onOpenAccount}>Account</button>}
            <button type="button" className="button button-quiet" disabled={checking} onClick={() => void retryCapability()}><Icon name="refresh" size={13} />Retry</button>
          </div>
        </div>
      ) : active ? (
        <div className="room-voice-controls">
          <button
            type="button"
            className={`room-voice-control${snapshot?.self.muted ? ' room-voice-control-off' : ''}`}
            aria-pressed={snapshot?.self.muted ?? false}
            onClick={() => sessionRef.current?.setMuted(!(snapshot?.self.muted ?? false))}
          >
            <Icon name="mic" size={15} />{snapshot?.self.muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className={`room-voice-control${snapshot?.self.deafened ? ' room-voice-control-off' : ''}`}
            aria-pressed={snapshot?.self.deafened ?? false}
            onClick={() => sessionRef.current?.setDeafened(!(snapshot?.self.deafened ?? false))}
          >
            <Icon name="headphones" size={15} />{snapshot?.self.deafened ? 'Undeafen' : 'Deafen'}
          </button>
          <button type="button" className="room-voice-control room-voice-leave" onClick={endVoice}>Leave</button>
        </div>
      ) : (
        <button type="button" className="button room-voice-join" disabled={checking} onClick={() => void joinVoice()}><Icon name="mic" size={15} />Join voice</button>
      )}

      {capability !== null && active && <small className="room-voice-device" title={capability.deviceLabel}>{capability.deviceLabel || 'Active microphone'} · noise suppression {capability.noiseSuppression ? 'on' : 'unavailable'}</small>}
      {message !== null && <p className="room-voice-message" role="status">{message}</p>}
      {[...remoteStreams].map(([userId, stream]) => <RemoteVoice key={userId} stream={stream} muted={snapshot?.self.deafened ?? false} />)}
    </section>
  );
}

function RemoteVoice({ stream, muted }: { stream: MediaStream; muted: boolean }): JSX.Element {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current !== null && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay muted={muted} className="room-voice-audio" aria-hidden="true" />;
}
