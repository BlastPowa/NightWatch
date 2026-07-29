import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { HtmlMediaSourceDescriptor } from '@shared/media';
import { deriveSourceKey } from '@shared/media';
import {
  parseMediaLoadEvent,
  parsePlaybackSnapshot,
  type PlaybackSnapshotV1,
} from '@shared/mediaPlayback';
import type { FileWatchReadinessEntry, RoomMediaSnapshot } from '@shared/roomComms';
import type { MediaPlatformBridge, PlaybackLease } from '@shared/mediaBridge';
import type { RoomService } from '@/lib/room/RoomService';
import {
  getMediaReadinessRoster,
  getRoomMediaDescriptor,
  publishRoomMediaDescriptor,
  reportMediaReadiness,
} from '@/lib/media/RoomMediaService';
import { getRoomMediaCapabilities } from '@/lib/media/roomMediaCapabilities';
import { Icon } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';

interface ActiveLease {
  descriptor: HtmlMediaSourceDescriptor;
  lease: PlaybackLease;
}

interface MovieWatchPanelProps {
  roomCode: string;
  service: RoomService;
  selfId: string;
  hostId: string | null;
  isHost: boolean;
  bridge: MediaPlatformBridge | null;
  htmlMediaAvailable: boolean;
  active: boolean;
  /** A Library selection stays descriptor-only until this host publishes it. */
  pendingSource?: HtmlMediaSourceDescriptor | null;
  onPendingSourceHandled?(): void;
  onModeChange(mode: 'youtube' | 'movie'): void;
  onHasMediaChange(hasMedia: boolean): void;
}

/**
 * The custom-media half of the room. Unlike the YouTube panel this owns an
 * HTML media element, but it never receives a path, OAuth header, Drive token,
 * or file byte from another participant. The room carries only the vetted
 * descriptor + synchronized state; each device obtains its own lease.
 */
export function MovieWatchPanel({
  roomCode,
  service,
  selfId,
  hostId,
  isHost,
  bridge,
  htmlMediaAvailable,
  active,
  pendingSource = null,
  onPendingSourceHandled,
  onModeChange,
  onHasMediaChange,
}: MovieWatchPanelProps): JSX.Element {
  const [capable, setCapable] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomMediaSnapshot | null>(null);
  const [lease, setLease] = useState<ActiveLease | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'local' | 'drive' | 'matching' | null>(null);
  const [readiness, setReadiness] = useState<FileWatchReadinessEntry[]>([]);
  const activeLeaseRef = useRef<ActiveLease | null>(null);
  const latestSnapshotRef = useRef<PlaybackSnapshotV1 | null>(null);
  const handledPendingSourceRef = useRef<string | null>(null);

  const source = snapshot?.mode.mode === 'file-watch' ? snapshot.mode.descriptor : null;
  const sessionId = snapshot === null ? null : roomMediaSessionId(snapshot.revision);
  const sourceKey = source === null ? null : deriveSourceKey(source);
  const canHostFileWatch = isHost && capable && bridge !== null;

  const releaseLease = useCallback(async (): Promise<void> => {
    const current = activeLeaseRef.current;
    if (current !== null && bridge !== null) {
      await bridge.releasePlaybackLease(current.lease.leaseId);
    }
    activeLeaseRef.current = null;
    setLease(null);
  }, [bridge]);

  const loadPersistedMode = useCallback(async (): Promise<void> => {
    const result = await getRoomMediaDescriptor(roomCode);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setSnapshot(result.value);
    if (result.value?.mode.mode === 'file-watch') {
      onModeChange('movie');
      // The existing floating mini-player is the official YouTube surface.
      // Custom media stays in its own room tab until its dedicated mini-player
      // UX is complete, rather than mounting a second ambiguous player.
      onHasMediaChange(false);
    }
  }, [onHasMediaChange, onModeChange, roomCode]);

  useEffect(() => {
    if (bridge === null || !htmlMediaAvailable) {
      setCapable(false);
      return;
    }
    let alive = true;
    void getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true }).then((features) => {
      if (alive) setCapable(features.fileWatch);
    });
    return () => { alive = false; };
  }, [bridge, htmlMediaAvailable]);

  useEffect(() => {
    void loadPersistedMode();
    const unlistenLoad = service.on('media:v1:load', (envelope) => {
      if (hostId !== null && envelope.senderId !== hostId) return;
      const parsed = parseMediaLoadEvent(envelope.data);
      if (!parsed.ok) return;
      // The authoritative row has the revision, readiness policy, and host
      // identity. Fetch it after the broadcast instead of trusting a peer to
      // tell us what policy applies.
      void loadPersistedMode();
    });
    const unlistenSnapshotRequest = service.on('media:v1:request-snapshot', (envelope) => {
      if (!isHost || envelope.senderId === selfId || latestSnapshotRef.current === null) return;
      void service.send('media:v1:snapshot', latestSnapshotRef.current);
    });
    return () => {
      unlistenLoad();
      unlistenSnapshotRequest();
    };
  }, [hostId, isHost, loadPersistedMode, selfId, service]);

  useEffect(() => {
    if (snapshot?.mode.mode !== 'file-watch' || source === null || bridge === null || !capable) return;
    if (isHost && activeLeaseRef.current?.descriptor.fingerprint === source.fingerprint) return;
    let alive = true;
    setBusy('matching');
    setMessage(isHost ? null : 'Checking this device for an authorized copy…');
    const request = source.kind === 'drive'
      ? bridge.createPlaybackLease(source).then((result) => result.ok
        ? { ok: true as const, value: { descriptor: source, lease: result.value } }
        : result)
      : bridge.resolveLocalMatch(source).then(async (result) => {
        if (!result.ok) return result;
        const localLease = await bridge.createPlaybackLease(result.value.descriptor);
        return localLease.ok
          ? { ok: true as const, value: { descriptor: result.value.descriptor, lease: localLease.value } }
          : localLease;
      });
    void request.then(async (result) => {
      if (!alive) return;
      if (!result.ok) {
        setMessage(result.error.message);
        setBusy(null);
        await reportMediaReadiness(roomCode, snapshot.revision, readinessForFailure(result.error.code));
        return;
      }
      if (!alive) {
        await bridge.releasePlaybackLease(result.value.lease.leaseId);
        return;
      }
      await releaseLease();
      const next = result.value;
      activeLeaseRef.current = next;
      setLease(next);
      setBusy(null);
      setMessage(null);
      await reportMediaReadiness(roomCode, snapshot.revision, 'ready');
    });
    return () => { alive = false; };
  }, [bridge, capable, isHost, releaseLease, roomCode, snapshot, source]);

  useEffect(() => {
    if (snapshot?.mode.mode !== 'file-watch') {
      setReadiness([]);
      return;
    }
    let alive = true;
    const refresh = (): void => {
      void getMediaReadinessRoster(roomCode, snapshot.revision).then((result) => {
        if (alive && result.ok) setReadiness(result.value);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [roomCode, snapshot]);

  useEffect(() => {
    if (snapshot?.mode.mode !== 'file-watch' || sessionId === null || sourceKey === null) return;
    const request = (): void => {
      if (!isHost) void service.send('media:v1:request-snapshot', { sessionId }).catch(() => {});
    };
    request();
    const timer = window.setInterval(request, 10_000);
    return () => window.clearInterval(timer);
  }, [isHost, service, sessionId, snapshot, sourceKey]);

  useEffect(() => () => { void releaseLease(); }, [releaseLease]);

  const publishHostSource = useCallback(async (descriptor: HtmlMediaSourceDescriptor): Promise<void> => {
    if (bridge === null || !canHostFileWatch) return;
    const nextLease = await bridge.createPlaybackLease(descriptor);
    if (!nextLease.ok) {
      setMessage(nextLease.error.message);
      return;
    }
    const mode = {
      modeVersion: 2 as const,
      mode: 'file-watch' as const,
      descriptor,
      readiness: 'all-ready' as const,
    };
    const published = await publishRoomMediaDescriptor(roomCode, snapshot?.revision ?? null, mode);
    if (!published.ok) {
      await bridge.releasePlaybackLease(nextLease.value.leaseId);
      setMessage(published.message);
      return;
    }
    await releaseLease();
    const next = { descriptor, lease: nextLease.value };
    activeLeaseRef.current = next;
    setLease(next);
    setSnapshot(published.value);
    latestSnapshotRef.current = null;
    onModeChange('movie');
    onHasMediaChange(false);
    await reportMediaReadiness(roomCode, published.value.revision, 'ready');
    await service.send('media:v1:load', {
      sessionId: roomMediaSessionId(published.value.revision),
      source: descriptor,
      revision: published.value.revision,
    });
  }, [bridge, canHostFileWatch, onHasMediaChange, onModeChange, releaseLease, roomCode, service, snapshot?.revision]);

  useEffect(() => {
    if (pendingSource === null) {
      handledPendingSourceRef.current = null;
      return;
    }
    if (!canHostFileWatch || bridge === null) return;
    const pendingKey = deriveSourceKey(pendingSource);
    const complete = (): void => {
      if (handledPendingSourceRef.current === pendingKey) return;
      handledPendingSourceRef.current = pendingKey;
      onPendingSourceHandled?.();
    };
    if (source !== null && deriveSourceKey(source) === pendingKey) {
      complete();
      return;
    }
    // A Library hand-off should take the host to Movie Watch even if its
    // device cannot immediately turn the descriptor into a playback lease.
    // That keeps the actionable error and source picker visible instead of
    // silently returning them to the YouTube panel.
    onModeChange('movie');
    setBusy(pendingSource.kind === 'drive' ? 'drive' : 'local');
    setMessage(null);
    void publishHostSource(pendingSource).finally(() => {
      setBusy(null);
      complete();
    });
  }, [bridge, canHostFileWatch, onModeChange, onPendingSourceHandled, pendingSource, publishHostSource, source]);

  async function chooseSource(kind: 'local' | 'drive'): Promise<void> {
    if (bridge === null || !canHostFileWatch) return;
    setBusy(kind);
    setMessage(null);
    try {
      const picked = kind === 'local' ? await bridge.pickLocalFile() : await bridge.pickDriveFile();
      if (!picked.ok) {
        if (picked.error.code !== 'cancelled') setMessage(picked.error.message);
        return;
      }
      await publishHostSource(picked.value.descriptor);
    } finally {
      setBusy(null);
    }
  }

  async function chooseMatchingLocalFile(): Promise<void> {
    if (bridge === null || source === null || source.kind !== 'local') return;
    setBusy('matching');
    try {
      const picked = await bridge.pickLocalFile();
      if (!picked.ok) {
        if (picked.error.code !== 'cancelled') setMessage(picked.error.message);
        return;
      }
      if (picked.value.descriptor.fingerprint !== source.fingerprint || picked.value.descriptor.size !== source.size) {
        setMessage('That file does not match the movie selected by the host.');
        await reportMediaReadiness(roomCode, snapshot?.revision ?? 0, 'fingerprint-mismatch');
        return;
      }
      const nextLease = await bridge.createPlaybackLease(picked.value.descriptor);
      if (!nextLease.ok) {
        setMessage(nextLease.error.message);
        return;
      }
      await releaseLease();
      const next = { descriptor: picked.value.descriptor, lease: nextLease.value };
      activeLeaseRef.current = next;
      setLease(next);
      setMessage(null);
      if (snapshot !== null) await reportMediaReadiness(roomCode, snapshot.revision, 'ready');
    } finally {
      setBusy(null);
    }
  }

  const readinessMap = useMemo(() => new Map(readiness.map((entry) => [entry.userId, entry])), [readiness]);

  if (!active) return <div className="movie-watch-panel movie-watch-panel-hidden" aria-hidden="true" />;

  return (
    <section className="movie-watch-panel" aria-labelledby="movie-watch-title">
      <header className="movie-watch-header">
        <div><span className="eyebrow">Authorized media</span><h2 id="movie-watch-title">Movie Watch</h2><p>Every viewer uses their own authorized local or Drive copy. NightWatch synchronizes state only.</p></div>
        {source !== null && <span className="movie-watch-source"><Icon name={source.kind === 'drive' ? 'cloud' : 'film'} size={15} />{source.kind === 'drive' ? 'Google Drive' : 'This computer'}</span>}
      </header>

      {!capable && <div className="movie-watch-state" role="status"><Icon name="lock" size={25} /><strong>Movie Watch is not ready on this device</strong><p>{bridge === null ? 'Local and Drive media are available only in the desktop NightWatch app.' : 'The room-media backend is not deployed or this account is not ready yet.'}</p></div>}

      {capable && source === null && (
        <div className="movie-watch-picker">
          <Icon name="film" size={34} /><h3>No movie selected</h3><p>{isHost ? 'Choose a file you own, then NightWatch will ask every participant to authorize the same copy.' : 'The host has not selected a Movie Watch source yet.'}</p>
          {isHost && <div className="movie-watch-picker-actions"><button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void chooseSource('local')}><Icon name="plus" size={16} />{busy === 'local' ? 'Preparing…' : 'Choose local video'}</button><button type="button" className="button" disabled={busy !== null} onClick={() => void chooseSource('drive')}><Icon name="cloud" size={16} />{busy === 'drive' ? 'Opening Drive…' : 'Choose Drive video'}</button></div>}
        </div>
      )}

      {capable && source !== null && (
        <>
          {lease !== null ? <FileWatchPlayer key={lease.lease.leaseId} lease={lease} service={service} isHost={isHost} hostId={hostId} sessionId={sessionId ?? roomMediaSessionId(snapshot?.revision ?? 1)} sourceKey={sourceKey ?? deriveSourceKey(source)} onSnapshot={(next) => { latestSnapshotRef.current = next; }} /> : <div className="movie-watch-state"><Icon name="clock" size={25} /><strong>{busy === 'matching' ? 'Authorizing this movie…' : 'A copy is needed on this device'}</strong><p>{message ?? (source.kind === 'drive' ? 'Connect Google Drive and authorize this shared file before playback can start.' : 'Choose your own matching local file to watch in sync.')}</p>{source.kind === 'local' && <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void chooseMatchingLocalFile()}><Icon name="plus" size={15} />Choose matching file</button>}</div>}
          <ReadinessRoster entries={readiness} selfId={selfId} selfEntry={readinessMap.get(selfId) ?? null} />
        </>
      )}
      {message !== null && source === null && <p className="movie-watch-message" role="status">{message}</p>}
    </section>
  );
}

function FileWatchPlayer({ lease, service, isHost, hostId, sessionId, sourceKey, onSnapshot }: { lease: ActiveLease; service: RoomService; isHost: boolean; hostId: string | null; sessionId: string; sourceKey: string; onSnapshot(snapshot: PlaybackSnapshotV1): void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const revisionRef = useRef(0);
  const applyingRef = useRef(false);
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [subtitleName, setSubtitleName] = useState<string | null>(null);
  const subtitleUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (subtitleUrlRef.current !== null) URL.revokeObjectURL(subtitleUrlRef.current);
  }, []);

  const sendSnapshot = useCallback((type: 'media:v1:play' | 'media:v1:pause' | 'media:v1:seek' | 'media:v1:snapshot') => {
    if (!isHost || applyingRef.current) return;
    const video = videoRef.current;
    if (video === null) return;
    revisionRef.current += 1;
    const next: PlaybackSnapshotV1 = {
      protocolVersion: 1,
      sessionId,
      sourceKey,
      positionSeconds: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      paused: video.paused,
      playbackRate: video.playbackRate,
      hostClockMs: Date.now(),
      revision: revisionRef.current,
    };
    onSnapshot(next);
    void service.send(type, next);
  }, [isHost, onSnapshot, service, sessionId, sourceKey]);

  useEffect(() => {
    const apply = (incoming: unknown): void => {
      const parsed = parsePlaybackSnapshot(incoming);
      if (!parsed.ok || parsed.value.sessionId !== sessionId || parsed.value.sourceKey !== sourceKey) return;
      if (hostId !== null && !isHost) {
        const video = videoRef.current;
        if (video === null) return;
        applyingRef.current = true;
        if (Math.abs(video.currentTime - parsed.value.positionSeconds) > .75) video.currentTime = parsed.value.positionSeconds;
        video.playbackRate = parsed.value.playbackRate;
        if (parsed.value.paused) video.pause(); else void video.play().catch(() => {});
        window.setTimeout(() => { applyingRef.current = false; }, 0);
      }
    };
    const events = ['media:v1:play', 'media:v1:pause', 'media:v1:seek', 'media:v1:snapshot'] as const;
    const off = events.map((event) => service.on(event, (envelope) => {
      if (hostId !== null && envelope.senderId !== hostId) return;
      if (envelope.senderId === service.selfId) return;
      apply(envelope.data);
    }));
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [hostId, isHost, service, sessionId, sourceKey]);

  function seek(delta: number): void {
    if (!isHost || videoRef.current === null) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + delta));
    sendSnapshot('media:v1:seek');
  }

  function togglePlayback(): void {
    const video = videoRef.current;
    if (!isHost || video === null) return;
    if (video.paused) void video.play(); else video.pause();
  }

  function setLocalVolume(next: number): void {
    const video = videoRef.current;
    if (video !== null) video.volume = Math.max(0, Math.min(1, next / 100));
    setVolume(next);
  }

  async function fullscreen(): Promise<void> {
    await videoRef.current?.requestFullscreen?.().catch(() => {});
  }

  function chooseSubtitles(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (file === null) return;
    const isVtt = file.type === 'text/vtt' || file.name.toLowerCase().endsWith('.vtt');
    if (!isVtt) return;
    if (subtitleUrlRef.current !== null) URL.revokeObjectURL(subtitleUrlRef.current);
    const next = URL.createObjectURL(file);
    subtitleUrlRef.current = next;
    setSubtitleUrl(next);
    setSubtitleName(file.name);
  }

  return <div className="movie-player-shell">
    <div className="movie-player-stage">
      <video ref={videoRef} src={lease.lease.playbackUrl} preload="metadata" onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || 0); setLocalVolume(volume); }} onPlay={() => { setPaused(false); sendSnapshot('media:v1:play'); }} onPause={() => { setPaused(true); sendSnapshot('media:v1:pause'); }} onSeeked={() => sendSnapshot('media:v1:seek')} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onEnded={() => { setPaused(true); sendSnapshot('media:v1:pause'); }}>
        {subtitleUrl !== null && <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} srcLang="en" label={subtitleName ?? 'Local subtitles'} default />}
      </video>
    </div>
    <div className="movie-player-controls" aria-label="Movie Watch player controls">
      <button type="button" className="movie-control movie-control-primary" disabled={!isHost} onClick={togglePlayback} aria-label={paused ? 'Play movie' : 'Pause movie'}><Icon name={paused ? 'play' : 'pause'} size={17} /></button>
      <button type="button" className="movie-control" disabled={!isHost} onClick={() => seek(-10)} aria-label="Seek back 10 seconds">−10</button>
      <label className="movie-progress"><span className="sr-only">Movie progress</span><input type="range" min={0} max={duration || 1} step={.1} value={Math.min(position, duration || 0)} disabled={!isHost} onChange={(event) => { if (videoRef.current !== null) videoRef.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); }} onMouseUp={() => sendSnapshot('media:v1:seek')} /><small>{formatTime(position)} / {formatTime(duration)}</small></label>
      <label className="movie-volume"><Icon name="sound" size={15} /><span className="sr-only">Local volume</span><input type="range" min={0} max={100} value={volume} onChange={(event) => setLocalVolume(Number(event.target.value))} /></label>
      <label className="movie-control movie-subtitle-control" title="Load a private WebVTT subtitle file"><span aria-hidden="true">CC</span><span className="sr-only">Load local WebVTT subtitles</span><input type="file" accept="text/vtt,.vtt" onChange={chooseSubtitles} /></label>
      <button type="button" className="movie-control" onClick={() => void fullscreen()} aria-label="Fullscreen"><Icon name="maximize" size={17} /></button>
    </div>
    {!isHost && <p className="movie-host-note"><Icon name="users" size={14} />The host controls playback; volume and fullscreen stay local.</p>}
  </div>;
}

function ReadinessRoster({ entries, selfId, selfEntry }: { entries: readonly { userId: string; displayName: string; avatarUrl: string | null; readiness: string }[]; selfId: string; selfEntry: { readiness: string } | null }): JSX.Element {
  return <section className="movie-readiness" aria-labelledby="movie-readiness-title"><div><span className="eyebrow">Viewer readiness</span><h3 id="movie-readiness-title">{entries.filter((entry) => entry.readiness === 'ready').length}/{entries.length || 1} ready</h3></div><div className="movie-readiness-list">{entries.length === 0 ? <p>Checking participant authorization…</p> : entries.map((entry) => <span key={entry.userId} className={`movie-readiness-person movie-readiness-${entry.readiness}`}><ProfileAvatar src={entry.avatarUrl} name={entry.displayName} /><small>{entry.userId === selfId ? 'You' : entry.displayName}</small><i>{entry.readiness === 'ready' ? 'Ready' : readinessLabel(entry.readiness)}</i></span>)}</div>{selfEntry !== null && selfEntry.readiness !== 'ready' && <p className="movie-readiness-hint">This device is marked {readinessLabel(selfEntry.readiness).toLowerCase()}.</p>}</section>;
}

function roomMediaSessionId(revision: number): string {
  return Math.max(1, revision).toString(16).padStart(32, '0');
}

function readinessForFailure(code: string): 'missing-file' | 'permission-required' | 'unsupported-codec' | 'offline' | 'rate-limited' {
  if (code === 'permission-denied' || code === 'auth-required' || code === 'auth-expired' || code === 'download-restricted') return 'permission-required';
  if (code === 'unsupported-codec' || code === 'unsupported-format') return 'unsupported-codec';
  if (code === 'offline') return 'offline';
  if (code === 'rate-limited') return 'rate-limited';
  return 'missing-file';
}

function readinessLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
