import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  deriveSourceKey,
  isSameSource,
  type HtmlMediaSourceDescriptor,
  type MediaCapabilities,
  type MediaFailure,
} from '@shared/media';
import {
  canStartCustomMediaSession,
  isFresherRevision,
  type MediaReadinessOutcome,
  type PlaybackSnapshotV1,
} from '@shared/mediaPlayback';
import type {
  DriveConnectionState,
  MediaPlatformBridge,
  SelectedMedia,
} from '@shared/mediaBridge';
import type { ReactionEmoji } from '@shared/reactions';
import type { RoomMember } from '@shared/room';
import { DriveRoomGuide, DriveShareActions } from '@/components/DriveShareActions';
import { Icon } from '@/components/Icon';
import { ReactionBar } from '@/components/ReactionBar';
import { HtmlMediaAdapter } from '@/lib/player/HtmlMediaAdapter';
import type { RoomService } from '@/lib/room/RoomService';

export interface MovieWatchController {
  unload(): void;
}

interface MovieWatchPanelProps {
  service: RoomService;
  members: readonly RoomMember[];
  selfId: string;
  isHost: boolean;
  bridge: MediaPlatformBridge;
  capabilities: MediaCapabilities;
  active: boolean;
  onRequestMode(mode: 'youtube' | 'movie'): void;
  onMediaStateChange(hasMedia: boolean): void;
  exposeController?(controller: MovieWatchController): void;
}

interface MovieSession {
  sessionId: string;
  source: HtmlMediaSourceDescriptor;
  sourceKey: string;
  revision: number;
}

interface MovieReaction {
  id: string;
  senderId: string;
  emoji: ReactionEmoji;
  positionSeconds: number;
}

type SourceState =
  | 'idle'
  | 'preparing'
  | 'permission-required'
  | 'missing-source'
  | 'source-mismatch'
  | 'unsupported'
  | 'ready'
  | 'error';

const SNAPSHOT_INTERVAL_MS = 5_000;
const READINESS_LABEL: Record<MediaReadinessOutcome, string> = {
  ready: 'Ready',
  'missing-source': 'Needs a matching file',
  'permission-required': 'Needs Drive permission',
  'unsupported-format': 'Unsupported on this device',
  'source-mismatch': 'Selected a different file',
  'incompatible-client': 'Update required',
};

function createSessionId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function boundedTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function errorState(failure: MediaFailure): SourceState {
  if (
    failure.code === 'auth-required' ||
    failure.code === 'auth-expired' ||
    failure.code === 'permission-denied' ||
    failure.code === 'drive-file-unavailable'
  ) {
    return 'permission-required';
  }
  if (failure.code === 'file-missing' || failure.code === 'fingerprint-unavailable') {
    return 'missing-source';
  }
  if (failure.code === 'source-mismatch' || failure.code === 'file-changed') {
    return 'source-mismatch';
  }
  if (failure.code === 'unsupported-codec' || failure.code === 'unsupported-format') {
    return 'unsupported';
  }
  return 'error';
}

function readinessOutcome(state: SourceState): MediaReadinessOutcome {
  if (state === 'permission-required') return 'permission-required';
  if (state === 'source-mismatch') return 'source-mismatch';
  if (state === 'unsupported') return 'unsupported-format';
  if (state === 'ready') return 'ready';
  return 'missing-source';
}

export function MovieWatchPanel({
  service,
  members,
  selfId,
  isHost,
  bridge,
  capabilities,
  active,
  onRequestMode,
  onMediaStateChange,
  exposeController,
}: MovieWatchPanelProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const adapterRef = useRef<HtmlMediaAdapter | null>(null);
  const sessionRef = useRef<MovieSession | null>(null);
  const revisionRef = useRef(0);
  const isHostRef = useRef(isHost);
  const applyingRemoteRef = useRef(false);
  const subtitleUrlRef = useRef<string | null>(null);
  isHostRef.current = isHost;

  const [session, setSession] = useState<MovieSession | null>(null);
  const [sourceState, setSourceState] = useState<SourceState>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<'local' | 'drive' | 'connect' | 'match' | null>(null);
  const [drive, setDrive] = useState<DriveConnectionState | null>(null);
  const [readiness, setReadiness] = useState<Map<string, MediaReadinessOutcome>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [volume, setVolume] = useState(100);
  const [subtitle, setSubtitle] = useState<{ url: string; label: string } | null>(null);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [reactions, setReactions] = useState<MovieReaction[]>([]);

  const compatible = useMemo(
    () =>
      canStartCustomMediaSession(
        members.map((member) => member.mediaProtocolVersions ?? []),
      ),
    [members],
  );
  const allReady =
    session !== null &&
    members.length > 0 &&
    members.every((member) => readiness.get(member.id) === 'ready');

  useEffect(() => {
    if (!capabilities.googleDrive) {
      setDrive(null);
      return;
    }
    let cancelled = false;
    void bridge.getDriveConnection().then((state) => {
      if (!cancelled) setDrive(state);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, capabilities.googleDrive]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video !== null) {
        setCurrentSeconds(boundedTime(video.currentTime));
        setDurationSeconds(Number.isFinite(video.duration) ? video.duration : 0);
        setPlaying(!video.paused);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribers = [
      service.on('media:v1:load', (envelope) => {
        const incoming = envelope.data;
        const current = sessionRef.current;
        onRequestMode('movie');
        if (
          current !== null &&
          current.sessionId === incoming.sessionId &&
          current.sourceKey === deriveSourceKey(incoming.source)
        ) {
          void service.send('media:v1:ready', {
            sessionId: current.sessionId,
            sourceKey: current.sourceKey,
            ready: sourceState === 'ready',
            outcome: readinessOutcome(sourceState),
          });
          if (!isHostRef.current) {
            void service.send('media:v1:request-snapshot', { sessionId: current.sessionId });
          }
          return;
        }
        void prepareIncoming(incoming.sessionId, incoming.source, incoming.revision);
      }),
      service.on('media:v1:ready', (envelope) => {
        if (!isHostRef.current || envelope.data.sessionId !== sessionRef.current?.sessionId) {
          return;
        }
        setReadiness((current) => {
          const next = new Map(current);
          next.set(envelope.senderId, envelope.data.outcome);
          return next;
        });
      }),
      service.on('media:v1:play', (envelope) => void applySnapshot(envelope.data)),
      service.on('media:v1:pause', (envelope) => void applySnapshot(envelope.data)),
      service.on('media:v1:seek', (envelope) => void applySnapshot(envelope.data)),
      service.on('media:v1:snapshot', (envelope) => void applySnapshot(envelope.data)),
      service.on('media:v1:request-snapshot', (envelope) => {
        const current = sessionRef.current;
        if (isHostRef.current && current !== null && envelope.data.sessionId === current.sessionId) {
          void publishSnapshot('media:v1:snapshot');
        }
      }),
      service.on('media:v1:reaction', (envelope) => {
        const current = sessionRef.current;
        if (
          current === null ||
          envelope.data.sessionId !== current.sessionId ||
          envelope.data.sourceKey !== current.sourceKey
        ) {
          return;
        }
        setReactions((items) =>
          [
            ...items,
            {
              id: crypto.randomUUID(),
              senderId: envelope.senderId,
              emoji: envelope.data.emoji,
              positionSeconds: envelope.data.positionSeconds,
            },
          ].slice(-250),
        );
      }),
      service.on('media:v1:unload', (envelope) => {
        if (envelope.data.sessionId === sessionRef.current?.sessionId) {
          clearSession();
        }
      }),
      service.on('playback:load', () => {
        clearSession(false);
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // Event handlers read current values from refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, sourceState]);

  useEffect(() => {
    if (!isHost || session === null || sourceState !== 'ready') {
      return;
    }
    setReadiness((current) => {
      const next = new Map(current);
      next.set(selfId, 'ready');
      return next;
    });
    const timer = window.setInterval(() => {
      if (allReady) void publishSnapshot('media:v1:snapshot');
    }, SNAPSHOT_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, isHost, selfId, session?.sessionId, sourceState]);

  useEffect(() => {
    const current = sessionRef.current;
    if (!isHost || current === null) {
      return;
    }
    setReadiness((previous) => {
      const next = new Map<string, MediaReadinessOutcome>();
      for (const member of members) {
        next.set(member.id, previous.get(member.id) ?? (member.id === selfId ? 'ready' : 'missing-source'));
      }
      return next;
    });
    void service.send('media:v1:load', {
      sessionId: current.sessionId,
      source: current.source,
      revision: current.revision,
    });
  }, [isHost, members, selfId, service]);

  useEffect(() => {
    onMediaStateChange(session !== null);
  }, [onMediaStateChange, session]);

  useEffect(() => {
    const controller: MovieWatchController = {
      unload: () => {
        const current = sessionRef.current;
        if (current !== null && isHostRef.current) {
          revisionRef.current += 1;
          void service.send('media:v1:unload', {
            sessionId: current.sessionId,
            revision: revisionRef.current,
          });
        }
        clearSession();
      },
    };
    exposeController?.(controller);
  }, [exposeController, service]);

  useEffect(() => {
    return () => {
      adapterRef.current?.destroy();
      if (subtitleUrlRef.current !== null) URL.revokeObjectURL(subtitleUrlRef.current);
      onMediaStateChange(false);
    };
  }, [onMediaStateChange]);

  function createAdapter(source: HtmlMediaSourceDescriptor): HtmlMediaAdapter | null {
    const video = videoRef.current;
    if (video === null) return null;
    adapterRef.current?.destroy();
    const adapter = new HtmlMediaAdapter(
      video,
      source.kind,
      (descriptor) => bridge.createPlaybackLease(descriptor),
      (leaseId) => bridge.releasePlaybackLease(leaseId),
    );
    adapter.setVolume(volume);
    adapter.subscribe((event) => {
      if (event.type === 'ready') {
        setBuffering(false);
        setDurationSeconds(event.durationSeconds ?? 0);
      } else if (event.type === 'buffering') {
        setBuffering(true);
      } else if (event.type === 'state') {
        setBuffering(false);
        setPlaying(!event.snapshot.paused);
        setCurrentSeconds(event.snapshot.positionSeconds);
      } else if (event.type === 'ended') {
        setPlaying(false);
      } else if (event.type === 'error') {
        setSourceState(errorState(event.error));
        setStatus(event.error.message);
      }
    });
    adapterRef.current = adapter;
    return adapter;
  }

  async function startHostSession(selected: SelectedMedia): Promise<void> {
    if (!compatible) {
      setStatus('Everyone must be on a Movie Watch-compatible desktop build before starting.');
      return;
    }
    setSourceState('preparing');
    setStatus(null);
    const id = createSessionId();
    const next: MovieSession = {
      sessionId: id,
      source: selected.descriptor,
      sourceKey: deriveSourceKey(selected.descriptor),
      revision: 1,
    };
    sessionRef.current = next;
    revisionRef.current = 1;
    setSession(next);
    await waitForVideoMount();
    const adapter = createAdapter(selected.descriptor);
    if (adapter === null) return;
    adapter.setSession(id, selected.descriptor, 1);
    const loaded = await adapter.load(selected.descriptor);
    if (!loaded.ok) {
      setSourceState(errorState(loaded.error));
      setStatus(loaded.error.message);
      return;
    }
    setSourceState('ready');
    setReadiness(new Map([[selfId, 'ready']]));
    setReactions([]);
    onRequestMode('movie');
    await service.send('media:v1:load', {
      sessionId: id,
      source: selected.descriptor,
      revision: 1,
    });
  }

  async function prepareIncoming(
    sessionId: string,
    source: HtmlMediaSourceDescriptor,
    revision: number,
  ): Promise<void> {
    const next: MovieSession = {
      sessionId,
      source,
      sourceKey: deriveSourceKey(source),
      revision,
    };
    sessionRef.current = next;
    revisionRef.current = revision;
    setSession(next);
    setSourceState('preparing');
    setStatus(null);
    setReactions([]);
    await waitForVideoMount();
    const adapter = createAdapter(source);
    if (adapter === null) return;
    adapter.setSession(sessionId, source, revision);
    const loaded = await adapter.load(source);
    if (!loaded.ok) {
      const nextState = errorState(loaded.error);
      setSourceState(nextState);
      setStatus(loaded.error.message);
      await reportReady(next, nextState);
      return;
    }
    setSourceState('ready');
    await reportReady(next, 'ready');
    await service.send('media:v1:request-snapshot', { sessionId });
  }

  async function reportReady(current: MovieSession, state: SourceState): Promise<void> {
    await service.send('media:v1:ready', {
      sessionId: current.sessionId,
      sourceKey: current.sourceKey,
      ready: state === 'ready',
      outcome: readinessOutcome(state),
    });
  }

  async function chooseLocal(): Promise<void> {
    setBusy('local');
    setStatus(null);
    const selected = await bridge.pickLocalFile();
    setBusy(null);
    if (!selected.ok) {
      if (selected.error.code !== 'cancelled') setStatus(selected.error.message);
      return;
    }
    await startHostSession(selected.value);
  }

  async function chooseDrive(): Promise<void> {
    setStatus(null);
    if (drive?.connected !== true) {
      setBusy('connect');
      const connected = await bridge.connectDrive();
      setBusy(null);
      if (!connected.ok) {
        if (connected.error.code !== 'auth-cancelled') setStatus(connected.error.message);
        return;
      }
      setDrive(connected.value);
    }
    setBusy('drive');
    const selected = await bridge.pickDriveFile();
    setBusy(null);
    if (!selected.ok) {
      if (selected.error.code !== 'cancelled') setStatus(selected.error.message);
      return;
    }
    await startHostSession(selected.value);
  }

  async function authorizeMatchingSource(): Promise<void> {
    const current = sessionRef.current;
    if (current === null) return;
    setBusy('match');
    setStatus(null);
    let selected;
    if (current.source.kind === 'drive') {
      if (drive?.connected !== true) {
        const connected = await bridge.connectDrive();
        if (!connected.ok) {
          setBusy(null);
          if (connected.error.code !== 'auth-cancelled') setStatus(connected.error.message);
          return;
        }
        setDrive(connected.value);
      }
      selected = await bridge.pickDriveFile();
    } else {
      selected = await bridge.pickLocalFile();
    }
    setBusy(null);
    if (!selected.ok) {
      if (selected.error.code !== 'cancelled') setStatus(selected.error.message);
      return;
    }
    if (!isSameSource(current.source, selected.value.descriptor)) {
      setSourceState('source-mismatch');
      setStatus('That is a different file. Choose the exact copy the host selected.');
      await reportReady(current, 'source-mismatch');
      return;
    }
    await prepareIncoming(current.sessionId, current.source, current.revision);
  }

  async function publishSnapshot(
    event: 'media:v1:play' | 'media:v1:pause' | 'media:v1:seek' | 'media:v1:snapshot',
  ): Promise<void> {
    const adapter = adapterRef.current;
    if (!isHostRef.current || adapter === null) return;
    revisionRef.current += 1;
    adapter.setRevision(revisionRef.current);
    const snapshot = adapter.getSnapshot();
    if (snapshot === null) return;
    const next = { ...snapshot, revision: revisionRef.current };
    setSession((current) => {
      if (current === null) return current;
      const updated = { ...current, revision: next.revision };
      sessionRef.current = updated;
      return updated;
    });
    await service.send(event, next);
  }

  async function applySnapshot(snapshot: PlaybackSnapshotV1): Promise<void> {
    const current = sessionRef.current;
    const adapter = adapterRef.current;
    if (
      isHostRef.current ||
      current === null ||
      adapter === null ||
      snapshot.sessionId !== current.sessionId ||
      snapshot.sourceKey !== current.sourceKey ||
      !isFresherRevision(revisionRef.current, snapshot.revision)
    ) {
      return;
    }
    revisionRef.current = snapshot.revision;
    adapter.setRevision(snapshot.revision);
    applyingRemoteRef.current = true;
    const latencySeconds = snapshot.paused
      ? 0
      : Math.max(0, Date.now() - snapshot.hostClockMs) / 1000;
    const target = snapshot.positionSeconds + latencySeconds * snapshot.playbackRate;
    const video = videoRef.current;
    if (video !== null) {
      video.playbackRate = snapshot.playbackRate;
      if (Math.abs(video.currentTime - target) > 0.65) {
        await adapter.seek(target);
      }
    }
    if (snapshot.paused) {
      await adapter.pause();
    } else {
      await adapter.play();
    }
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 0);
  }

  async function togglePlayback(): Promise<void> {
    const adapter = adapterRef.current;
    if (!isHost || adapter === null || !allReady) return;
    if (videoRef.current?.paused !== false) {
      await adapter.play();
      await publishSnapshot('media:v1:play');
    } else {
      await adapter.pause();
      await publishSnapshot('media:v1:pause');
    }
  }

  function previewSeek(event: ChangeEvent<HTMLInputElement>): void {
    const position = Number(event.target.value);
    setCurrentSeconds(position);
    void adapterRef.current?.seek(position);
  }

  function commitSeek(): void {
    if (isHost && !applyingRemoteRef.current) {
      void publishSnapshot('media:v1:seek');
    }
  }

  function changeVolume(event: ChangeEvent<HTMLInputElement>): void {
    const next = Number(event.target.value);
    setVolume(next);
    adapterRef.current?.setVolume(next);
  }

  function sendReaction(emoji: ReactionEmoji): void {
    const current = sessionRef.current;
    if (current === null || sourceState !== 'ready') return;
    const positionSeconds = boundedTime(videoRef.current?.currentTime ?? 0);
    setReactions((items) => [
      ...items,
      { id: crypto.randomUUID(), senderId: selfId, emoji, positionSeconds },
    ].slice(-250));
    void service.send('media:v1:reaction', {
      sessionId: current.sessionId,
      sourceKey: current.sourceKey,
      emoji,
      positionSeconds,
    });
  }

  async function importSubtitle(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    const lower = file.name.toLocaleLowerCase();
    if (!lower.endsWith('.vtt') && !lower.endsWith('.srt')) {
      setStatus('Choose a WebVTT (.vtt) or SubRip (.srt) subtitle file.');
      return;
    }
    const text = await file.text();
    const vtt = lower.endsWith('.srt') ? srtToVtt(text) : text;
    if (subtitleUrlRef.current !== null) URL.revokeObjectURL(subtitleUrlRef.current);
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    subtitleUrlRef.current = url;
    setSubtitle({ url, label: file.name });
    setCaptionsOn(true);
    window.setTimeout(() => setTextTrackMode(true), 0);
  }

  function setTextTrackMode(showing: boolean): void {
    const track = videoRef.current?.textTracks[0];
    if (track !== undefined) track.mode = showing ? 'showing' : 'hidden';
  }

  function toggleCaptions(): void {
    const next = !captionsOn;
    setCaptionsOn(next);
    setTextTrackMode(next);
  }

  async function toggleFullscreen(): Promise<void> {
    const stage = videoRef.current?.closest<HTMLElement>('.movie-player-stage');
    if (stage === null || stage === undefined) return;
    if (document.fullscreenElement === null) {
      await stage.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  function clearSession(report = true): void {
    adapterRef.current?.destroy();
    adapterRef.current = null;
    sessionRef.current = null;
    revisionRef.current = 0;
    setSession(null);
    setSourceState('idle');
    setReadiness(new Map());
    setPlaying(false);
    setBuffering(false);
    setCurrentSeconds(0);
    setDurationSeconds(0);
    setReactions([]);
    setStatus(null);
    if (report) onMediaStateChange(false);
  }

  async function waitForVideoMount(): Promise<void> {
    if (videoRef.current !== null) return;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  return (
    <div className={`movie-watch-panel${active ? ' movie-watch-active' : ' movie-watch-hidden'}`}>
      {session === null ? (
        <div className="movie-source-launcher">
          <div className="movie-launch-copy">
            <span className="eyebrow">Movie Watch</span>
            <h2>Play an authorized file together</h2>
            <p>
              NightWatch synchronizes playback state only. Every viewer streams their own
              permitted local or Google Drive copy of the same fingerprinted file.
            </p>
          </div>
          {isHost ? (
            <div className="movie-source-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy !== null || !capabilities.localFiles || !compatible}
                onClick={() => void chooseLocal()}
              >
                <Icon name="film" size={17} />
                {busy === 'local' ? 'Preparing…' : 'Choose from this PC'}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy !== null || !capabilities.googleDrive || !compatible}
                onClick={() => void chooseDrive()}
              >
                <Icon name="cloud" size={17} />
                {busy === 'drive' || busy === 'connect' ? 'Opening Drive…' : 'Choose from Drive'}
              </button>
              <DriveShareActions />
              {!compatible && members.length > 0 && (
                <p className="movie-compatibility-warning">
                  <Icon name="info" size={15} />
                  Everyone must update to a Movie Watch-compatible desktop build.
                </p>
              )}
            </div>
          ) : (
            <div className="movie-waiting">
              <span className="loader-orbit" />
              Waiting for the host to choose a movie.
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="movie-player-stage">
            <video ref={videoRef} preload="metadata" playsInline crossOrigin="anonymous">
              {subtitle !== null && (
                <track
                  key={subtitle.url}
                  kind="subtitles"
                  src={subtitle.url}
                  srcLang="en"
                  label={subtitle.label}
                  default
                />
              )}
            </video>
            {buffering && <div className="movie-buffering"><span className="loader-orbit" />Buffering…</div>}
            <div className="movie-controls">
              <button
                type="button"
                className="movie-control movie-control-primary"
                disabled={!isHost || !allReady}
                onClick={() => void togglePlayback()}
                aria-label={playing ? 'Pause movie' : 'Play movie'}
              >
                <Icon name={playing ? 'pause' : 'play-solid'} size={18} />
              </button>
              <span className="movie-time">{formatTime(currentSeconds)} / {formatTime(durationSeconds)}</span>
              <input
                className="movie-seek"
                type="range"
                min={0}
                max={Math.max(1, durationSeconds)}
                step={0.1}
                value={Math.min(currentSeconds, Math.max(1, durationSeconds))}
                disabled={!isHost || sourceState !== 'ready'}
                aria-label="Movie position"
                onChange={previewSeek}
                onPointerUp={commitSeek}
                onKeyUp={commitSeek}
              />
              <input
                className="movie-volume"
                type="range"
                min={0}
                max={100}
                value={volume}
                aria-label="Movie volume"
                onChange={changeVolume}
              />
              <label className="movie-control" title="Import WebVTT or SubRip subtitles">
                CC
                <input type="file" accept=".vtt,.srt,text/vtt,application/x-subrip" onChange={(event) => void importSubtitle(event)} />
              </label>
              {subtitle !== null && (
                <button type="button" className="movie-control" onClick={toggleCaptions}>
                  {captionsOn ? 'CC on' : 'CC off'}
                </button>
              )}
              <button type="button" className="movie-control" onClick={() => void toggleFullscreen()} aria-label="Fullscreen">
                <Icon name="maximize" size={17} />
              </button>
            </div>
          </div>

          <div className="movie-meta">
            <div>
              <span className="eyebrow">{session.source.kind === 'drive' ? 'Google Drive' : 'This computer'} · private stream</span>
              <h2>{session.source.title}</h2>
              <p>{session.source.mimeType} · {formatBytes(session.source.size)}</p>
            </div>
            <span className={`movie-ready-badge movie-ready-${allReady ? 'yes' : 'waiting'}`}>
              <Icon name={allReady ? 'check' : 'clock'} size={15} />
              {allReady ? 'Everyone ready' : 'Waiting for viewers'}
            </span>
          </div>

          <div className="movie-readiness-grid">
            {members.map((member) => {
              const outcome =
                readiness.get(member.id) ??
                ((member.mediaProtocolVersions ?? []).includes(1)
                  ? 'missing-source'
                  : 'incompatible-client');
              return (
                <div key={member.id} className={`movie-readiness movie-readiness-${outcome === 'ready' ? 'ready' : 'waiting'}`}>
                  <span className="status-dot" />
                  <strong>{member.displayName}{member.id === selfId ? ' (you)' : ''}</strong>
                  <small>{READINESS_LABEL[outcome]}</small>
                </div>
              );
            })}
          </div>

          {sourceState !== 'ready' && !isHost && (
            <div className="movie-access-card">
              <div>
                <span className="eyebrow">Your copy is required</span>
                <h3>{sourceState === 'permission-required' ? 'Google Drive permission needed' : 'Match the host’s exact file'}</h3>
                <p>{status ?? 'Choose or authorize the same file. NightWatch verifies its fingerprint before joining sync.'}</p>
                {session.source.kind === 'drive' && <DriveRoomGuide role="viewer" />}
              </div>
              <div className="movie-access-actions">
                {session.source.kind === 'drive' && (
                  <DriveShareActions fileId={session.source.fileId} mode="viewer" compact />
                )}
                <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void authorizeMatchingSource()}>
                  <Icon name={session.source.kind === 'drive' ? 'cloud' : 'film'} size={16} />
                  {busy === 'match' ? 'Checking…' : session.source.kind === 'drive' ? 'Authorize shared file' : 'Choose matching file'}
                </button>
              </div>
            </div>
          )}

          {isHost && session.source.kind === 'drive' && (
            <div className="movie-drive-host">
              <div><span className="eyebrow">Host sharing</span><strong>Give every viewer access to this Drive file</strong></div>
              <DriveShareActions fileId={session.source.fileId} mode="host" compact />
            </div>
          )}

          <div className="movie-reaction-row">
            <div>
              <span className="eyebrow">Specific moments</span>
              <strong>React at {formatTime(currentSeconds)}</strong>
              <small>{reactions.length} room reaction{reactions.length === 1 ? '' : 's'} marked</small>
            </div>
            <ReactionBar disabled={sourceState !== 'ready'} onReact={sendReaction} />
          </div>
          {reactions.length > 0 && durationSeconds > 0 && (
            <div className="movie-reaction-track" aria-label="Movie reaction timeline">
              {reactions.map((reaction) => (
                <button
                  key={reaction.id}
                  type="button"
                  style={{ left: `${Math.min(100, (reaction.positionSeconds / durationSeconds) * 100)}%` }}
                  title={`${reaction.emoji} at ${formatTime(reaction.positionSeconds)}`}
                  disabled={!isHost}
                  onClick={() => {
                    void adapterRef.current?.seek(reaction.positionSeconds);
                    commitSeek();
                  }}
                >
                  {reaction.emoji}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {status !== null && sourceState === 'ready' && <p className="movie-status" role="status">{status}</p>}
    </div>
  );
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function srtToVtt(input: string): string {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  const body = normalized
    .replace(/^\d+\s*$/gm, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/\n{3,}/g, '\n\n');
  return `WEBVTT\n\n${body}\n`;
}
