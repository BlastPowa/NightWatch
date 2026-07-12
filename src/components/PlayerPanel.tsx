import { useEffect, useRef, useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import { ReactionBar } from '@/components/ReactionBar';
import { achievementTracker } from '@/lib/engagement/AchievementTracker';
import { updateRichPresence } from '@/lib/presence';
import { recordWatch } from '@/lib/rooms/HistoryService';
import { sessionRecorder } from '@/lib/analytics/SessionRecorder';
import { ReactionOverlay } from '@/components/ReactionOverlay';
import { TimelineMarkers } from '@/components/TimelineMarkers';
import { MomentNotesPanel } from '@/components/MomentNotesPanel';
import { useAuth } from '@/hooks/useAuth';
import { useSocialCapabilities } from '@/hooks/useSocialCapabilities';
import { useReactions } from '@/hooks/useReactions';
import { useSettings } from '@/hooks/useSettings';
import { YouTubePlayer } from '@/lib/player/YouTubePlayer';
import type { RoomService } from '@/lib/room/RoomService';
import { settingsStore } from '@/lib/settings';
import { SyncEngine } from '@/lib/sync/SyncEngine';

interface PlayerPanelProps {
  service: RoomService;
  isHost: boolean;
  roomCode: string;
  allowRoomMomentNotes: boolean;
  /** Host auto-advance: take the next queued entry when a video ends. */
  takeNextFromQueue: () => { videoId: string } | null;
  /** Hands the parent a loader so other panels (queue) can start videos. */
  exposeLoadVideo?: (loader: (videoId: string, startSeconds?: number) => void) => void;
}

/**
 * Embedded YouTube player wired to the room's SyncEngine, with the
 * reaction overlay/bar/timeline. The host loads videos and drives playback
 * with the player's native controls; viewers follow (ADR-006). Reactions
 * are open to everyone.
 */
export function PlayerPanel({
  service,
  isHost,
  roomCode,
  allowRoomMomentNotes,
  takeNextFromQueue,
  exposeLoadVideo,
}: PlayerPanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const takeNextRef = useRef(takeNextFromQueue);
  const pendingSeekRef = useRef<number | null>(null);
  takeNextRef.current = takeNextFromQueue;

  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [syncDelayMs, setSyncDelayMs] = useState<number | null>(null);
  const videoIdRef = useRef<string | null>(null);
  videoIdRef.current = videoId;
  const settings = useSettings();
  const authUser = useAuth();
  const socialCapabilities = useSocialCapabilities(authUser !== null);

  const { bursts, markers, send, removeBurst } = useReactions(
    service,
    () => ({
      videoId: videoIdRef.current,
      positionSeconds: playerRef.current?.getCurrentTime() ?? 0,
    }),
    videoId,
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const mountPoint = document.createElement('div');
    container.appendChild(mountPoint);

    const player = new YouTubePlayer({
      onReady: () => player.setVolume(settingsStore.get().volumePercent),
      onStateChange: (state) => {
        engineRef.current?.handleLocalStateChange(state);
        if (
          pendingSeekRef.current !== null &&
          isHostRef.current &&
          (state === 'playing' || state === 'cued' || state === 'buffering')
        ) {
          const target = pendingSeekRef.current;
          pendingSeekRef.current = null;
          engineRef.current?.seekTo(target);
        }
        // Opt-in insights (Phase 17): the recorder no-ops unless enabled.
        if (isHostRef.current && (state === 'playing' || state === 'paused')) {
          sessionRecorder.playback(
            state === 'playing' ? 'play' : 'pause',
            player.getCurrentTime(),
          );
        }
        // Auto-advance (ADR-013): when the video ends, the host plays the
        // top-voted queue entry through the normal load/broadcast path.
        if (state === 'ended' && isHostRef.current) {
          const next = takeNextRef.current();
          if (next !== null) {
            engineRef.current?.loadVideo(next.videoId);
          }
        }
      },
      onError: (message) => setError(message),
    });
    playerRef.current = player;

    const engine = new SyncEngine(service, player, () => isHostRef.current, {
      onVideoChanged: (id) => {
        setVideoId(id);
        setError(null);
      },
      onDelayMeasured: (delayMs) => setSyncDelayMs(delayMs),
    });
    engineRef.current = engine;

    let disposed = false;
    void player.mount(mountPoint).then(
      () => {
        if (!disposed) {
          engine.start();
        }
      },
      () => {
        if (!disposed) {
          setError('Could not load the YouTube player. Check your connection.');
        }
      },
    );

    return () => {
      disposed = true;
      engineRef.current = null;
      playerRef.current = null;
      engine.stop();
      player.destroy();
      container.replaceChildren();
      setVideoId(null);
      setDurationSeconds(0);
    };
  }, [service]);

  // Apply persisted/changed volume through the official API.
  useEffect(() => {
    playerRef.current?.setVolume(settings.volumePercent);
  }, [settings.volumePercent]);

  // Attribute insight events to the video they happened in (Phase 21
  // highlights). A reaction position means nothing without knowing which video
  // it was in, and a session routinely spans several.
  useEffect(() => {
    sessionRecorder.setVideo(videoId);
  }, [videoId]);

  // Track duration for the timeline strip (0 until a video is loaded) and
  // count active watch time for the local engagement dashboard.
  useEffect(() => {
    if (videoId === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setDurationSeconds(playerRef.current?.getDuration() ?? 0);
      setCurrentSeconds(playerRef.current?.getCurrentTime() ?? 0);
      if (playerRef.current?.getState() === 'playing') {
        achievementTracker.tickWatch(1);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [videoId]);

  // Discord Rich Presence: report room + video title; clear on unmount.
  useEffect(() => {
    updateRichPresence({ roomCode, videoTitle: null });
    if (videoId === null) {
      return;
    }
    // Title is available shortly after the video loads.
    const timer = window.setTimeout(() => {
      const videoTitle = playerRef.current?.getVideoTitle() ?? null;
      updateRichPresence({ roomCode, videoTitle });
      // Persistent-room watch history (Phase 16): host writes one entry;
      // the server ignores ephemeral codes and dedupes repeats.
      if (isHostRef.current) {
        recordWatch(roomCode, videoId, videoTitle);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [roomCode, videoId]);

  useEffect(() => {
    return () => updateRichPresence(null);
  }, []);

  function handleLoad(event: FormEvent): void {
    event.preventDefault();
    const id = extractVideoId(url);
    if (id === null) {
      setError('That does not look like a YouTube link or video id.');
      return;
    }
    setError(null);
    loadVideo(id);
  }

  function loadVideo(id: string, startSeconds?: number): void {
    achievementTracker.record('video-loaded');
    pendingSeekRef.current = typeof startSeconds === 'number' && startSeconds > 0 ? startSeconds : null;
    engineRef.current?.loadVideo(id);
  }

  const exposeLoadVideoRef = useRef(exposeLoadVideo);
  exposeLoadVideoRef.current = exposeLoadVideo;
  useEffect(() => {
    exposeLoadVideoRef.current?.((id, startSeconds) => loadVideo(id, startSeconds));
    // loadVideo is stable in behavior (uses refs internally).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasVideo = videoId !== null;

  return (
    <div className="player-panel">
      {isHost ? (
        // Search/browse moved to the Discovery panel below the player
        // (Phase 16) — the host bar keeps direct link loading.
        <form className="player-form" onSubmit={handleLoad}>
          <input
            className="input"
            value={url}
            placeholder="Paste a YouTube link…"
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
          />
          <button type="submit" className="button button-glow">
            Load video
          </button>
        </form>
      ) : (
        <p className="player-viewer-note">
          The host controls playback.
          {syncDelayMs !== null && ` · sync delay ~${syncDelayMs}ms`}
        </p>
      )}

      {error !== null && <p className="form-error">{error}</p>}

      <div
        className={`player-frame${hasVideo ? '' : ' player-frame-empty'}`}
        style={{
          filter:
            `brightness(${settings.videoFilters.brightness}%) ` +
            `contrast(${settings.videoFilters.contrast}%) ` +
            `saturate(${settings.videoFilters.saturation}%)`,
        }}
      >
        <div ref={containerRef} className="player-mount" />
        <ReactionOverlay bursts={bursts} onDone={removeBurst} />
        {!hasVideo && (
          <span className="player-placeholder">
            {isHost ? 'No video loaded' : 'Waiting for the host to pick a video…'}
          </span>
        )}
      </div>

      <TimelineMarkers markers={markers} durationSeconds={durationSeconds} />
      <div className="player-community-bar">
        <div className="player-community-copy">
          <span className="eyebrow">Room reactions</span>
          <strong>{hasVideo ? 'Mark this moment' : 'Reactions unlock with a video'}</strong>
          <small>{markers.length > 0 ? `${markers.length} moment${markers.length === 1 ? '' : 's'} marked on the timeline` : 'Your reactions appear below the video, never over its controls.'}</small>
        </div>
        <ReactionBar disabled={!hasVideo} onReact={send} />
      </div>
      {hasVideo && authUser !== null && socialCapabilities.momentNotes && (
        <MomentNotesPanel
          videoId={videoId}
          roomCode={roomCode}
          durationSeconds={durationSeconds}
          currentSeconds={currentSeconds}
          currentUserId={authUser.id}
          isHost={isHost}
          allowRoomVisibility={allowRoomMomentNotes}
          onSeek={(seconds) => engineRef.current?.seekTo(seconds)}
        />
      )}
    </div>
  );
}
