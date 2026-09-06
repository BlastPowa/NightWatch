import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomMediaMode, RoomMediaSnapshot } from '@shared/roomComms';
import { Icon } from '@/components/Icon';
import { explainRoomMediaCapabilities, getRoomMediaCapabilities, resetRoomMediaCapabilities, type CapabilityDisabledReason } from '@/lib/media/roomMediaCapabilities';
import { getRoomMediaDescriptor, publishRoomMediaDescriptor } from '@/lib/media/RoomMediaService';
import { ShareSession } from '@/lib/rtc/ShareSession';

interface ScreenWatchPanelProps {
  roomCode: string;
  selfId: string;
  isHost: boolean;
  active: boolean;
  onOpenAccount?(): void;
  /** Last known YouTube id is used to restore the room after a share stops. */
  youtubeVideoId: string | null;
}

/**
 * ScreenWatch uses the existing WebRTC share session. Supabase only carries
 * SDP/ICE signaling and the room stores a short-lived session descriptor; no
 * screen pixels or media files pass through the database or the host.
 */
export function ScreenWatchPanel({
  roomCode,
  selfId,
  isHost,
  active,
  onOpenAccount,
  youtubeVideoId,
}: ScreenWatchPanelProps): JSX.Element {
  const [capable, setCapable] = useState(false);
  const [disabledReason, setDisabledReason] = useState<CapabilityDisabledReason>('signed-out');
  const [checking, setChecking] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomMediaSnapshot | null>(null);
  const [phase, setPhase] = useState<'idle' | 'picking-source' | 'connecting' | 'sharing' | 'ended'>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<ShareSession | null>(null);
  const startedViewingRef = useRef<string | null>(null);
  const previousYoutubeRef = useRef<Extract<RoomMediaMode, { mode: 'youtube' }> | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const createSession = useCallback((): ShareSession => {
    const existing = sessionRef.current;
    if (existing !== null) return existing;
    const next = new ShareSession(roomCode, selfId, {
      onPhase: (nextPhase, reason) => {
        setPhase(nextPhase);
        if (reason === 'permission-denied') setMessage('Screen sharing permission was declined.');
        if (reason === 'source-closed') setMessage('The shared window or desktop was closed.');
      },
      onRemoteStream: setRemoteStream,
      onViewerCount: setViewerCount,
    });
    sessionRef.current = next;
    return next;
  }, [roomCode, selfId]);

  const loadSnapshot = useCallback(async (): Promise<void> => {
    const result = await getRoomMediaDescriptor(roomCode);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setSnapshot(result.value);
    const mode = result.value?.mode;
    if (mode?.mode === 'youtube') previousYoutubeRef.current = mode;
    if (mode?.mode !== 'live-share' || mode.sharerId === selfId || startedViewingRef.current === mode.sessionId) return;
    const session = createSession();
    startedViewingRef.current = mode.sessionId;
    const viewing = await session.startViewing(mode.sharerId, mode.sessionId);
    if (!viewing.ok) {
      startedViewingRef.current = null;
      setMessage(viewing.message);
    }
  }, [createSession, roomCode, selfId]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void getRoomMediaCapabilities({ htmlMedia: false, googleDrive: false }).then((features) => {
      if (alive) {
        setCapable(features.liveShare && ShareSession.supported());
        setDisabledReason(explainRoomMediaCapabilities({ htmlMedia: false, googleDrive: false }).liveShare);
      }
    });
    return () => { alive = false; };
  }, [active]);

  async function retryCapabilities(): Promise<void> {
    setChecking(true);
    resetRoomMediaCapabilities();
    try {
      const features = await getRoomMediaCapabilities({ htmlMedia: false, googleDrive: false });
      setCapable(features.liveShare && ShareSession.supported());
      setDisabledReason(explainRoomMediaCapabilities({ htmlMedia: false, googleDrive: false }).liveShare);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!active || !capable) return;
    void loadSnapshot();
    const timer = window.setInterval(() => { void loadSnapshot(); }, 4_000);
    return () => window.clearInterval(timer);
  }, [active, capable, loadSnapshot]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video !== null && video.srcObject !== remoteStream) video.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => () => {
    sessionRef.current?.end('stopped');
    sessionRef.current = null;
  }, []);

  async function startSharing(): Promise<void> {
    if (!capable || !isHost) return;
    setMessage(null);
    const session = createSession();
    const started = await session.startSharing();
    if (!started.ok) {
      setMessage(started.message);
      return;
    }
    const mode: Extract<RoomMediaMode, { mode: 'live-share' }> = {
      modeVersion: 2,
      mode: 'live-share',
      sessionId: session.getSessionId(),
      sharerId: selfId,
      sourceLabel: 'Screen or window',
    };
    const published = await publishRoomMediaDescriptor(roomCode, snapshot?.revision ?? null, mode);
    if (!published.ok) {
      session.end('error');
      setMessage(published.message);
      return;
    }
    setSnapshot(published.value);
    setPhase('sharing');
  }

  async function stopSharing(): Promise<void> {
    sessionRef.current?.end('stopped');
    sessionRef.current = null;
    startedViewingRef.current = null;
    setRemoteStream(null);
    setPhase('ended');
    const fallback = previousYoutubeRef.current ?? (youtubeVideoId !== null && /^[A-Za-z0-9_-]{11}$/.test(youtubeVideoId)
      ? { modeVersion: 2 as const, mode: 'youtube' as const, descriptor: { schemaVersion: 1 as const, kind: 'youtube' as const, videoId: youtubeVideoId } }
      : null);
    if (isHost && fallback !== null) {
      const restored = await publishRoomMediaDescriptor(roomCode, snapshot?.revision ?? null, fallback);
      if (!restored.ok) setMessage(restored.message);
      else setSnapshot(restored.value);
    } else if (isHost) {
      setMessage('Screen sharing stopped. Load a YouTube video to return the room to YouTube Watch.');
    }
  }

  if (!active) return <div className="screen-watch-panel screen-watch-panel-hidden" aria-hidden="true" />;

  const isSharer = snapshot?.mode.mode === 'live-share' && snapshot.mode.sharerId === selfId;
  const unavailableMessage = !ShareSession.supported()
    ? 'Screen sharing needs a secure browser or the packaged Electron app.'
    : disabledReason === 'signed-out'
      ? 'Connect a NightWatch account first, then the room relay can safely coordinate the share.'
      : disabledReason === 'relay-not-configured'
        ? 'Your account is connected. The room relay (TURN) still needs to be deployed before live sharing can start.'
        : disabledReason === 'not-deployed'
          ? 'Your account is connected, but the ScreenWatch room services are not deployed yet.'
          : 'Screen sharing is unavailable on this platform.';
  return (
    <section className="screen-watch-panel" aria-labelledby="screen-watch-title">
      <header className="screen-watch-header">
        <div><span className="eyebrow">Room live share</span><h2 id="screen-watch-title">ScreenWatch</h2><p>Share a window or your full desktop through a direct WebRTC connection. NightWatch never stores or relays the pixels.</p></div>
        <span className={`screen-watch-status screen-watch-status-${phase}`}><span className="status-dot" aria-hidden="true" />{phase === 'sharing' ? 'Sharing live' : phase === 'connecting' ? 'Connecting' : 'Ready'}</span>
      </header>
      <details className="screen-watch-help" open>
        <summary><Icon name="info" size={16} /> How ScreenWatch works</summary>
        <div className="screen-watch-help-body">
          <p><strong>1. The host starts the share.</strong> Choose ScreenWatch, click <em>Share screen</em>, then select a window, browser tab, or the full desktop in the system picker.</p>
          <p><strong>2. Everyone else joins.</strong> Each viewer clicks <em>Join share</em>. Their device receives the live picture directly; the room only coordinates the connection.</p>
          <p><strong>3. Stop any time.</strong> Closing the shared window, revoking the permission, or clicking <em>Stop sharing</em> ends the share for everyone. Nothing is uploaded or recorded.</p>
        </div>
      </details>
      {!capable && <div className="screen-watch-state" role="status"><Icon name="lock" size={28} /><strong>ScreenWatch is not ready in this session</strong><p>{unavailableMessage}</p><div className="screen-watch-state-actions">{disabledReason === 'signed-out' && onOpenAccount !== undefined && <button type="button" className="button button-primary" onClick={onOpenAccount}><Icon name="profile" size={16} />Open account settings</button>}<button type="button" className="button" onClick={() => void retryCapabilities()} disabled={checking}><Icon name="refresh" size={16} />{checking ? 'Checking…' : 'Check again'}</button></div></div>}
      {capable && snapshot?.mode.mode === 'live-share' && !isSharer && remoteStream === null && <div className="screen-watch-state" role="status"><Icon name="monitor" size={28} /><strong>Waiting for the shared screen</strong><p>{snapshot.mode.sourceLabel} is being offered by the host. Choose “join share” to view it on this device.</p><button type="button" className="button button-primary" onClick={() => void loadSnapshot()}>Join share</button></div>}
      {capable && snapshot?.mode.mode === 'live-share' && !isSharer && remoteStream !== null && <video ref={remoteVideoRef} className="screen-watch-video" autoPlay playsInline controls aria-label="Shared screen" />}
      {capable && (snapshot?.mode.mode !== 'live-share' || isSharer) && <div className="screen-watch-actions"><div className="screen-watch-prompt"><Icon name="monitor" size={30} /><strong>{isSharer ? 'You are sharing' : 'Share a window or desktop'}</strong><span>The browser/Electron picker lets you choose a specific window, tab, or entire display.</span></div>{isSharer ? <button type="button" className="button button-danger" onClick={() => void stopSharing()}>Stop sharing</button> : <button type="button" className="button button-primary" onClick={() => void startSharing()} disabled={!isHost}><Icon name="monitor" size={16} />{isHost ? 'Share screen' : 'Host chooses the share'}</button>}</div>}
      {isSharer && <p className="screen-watch-viewers" role="status">{viewerCount} viewer{viewerCount === 1 ? '' : 's'} connected</p>}
      {message !== null && <p className="screen-watch-message" role="status">{message}</p>}
    </section>
  );
}
