import { useEffect, useRef, useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import { ReactionBar } from '@/components/ReactionBar';
import { ReactionOverlay } from '@/components/ReactionOverlay';
import { TimelineMarkers } from '@/components/TimelineMarkers';
import { useReactions } from '@/hooks/useReactions';
import { useSettings } from '@/hooks/useSettings';
import { YouTubePlayer } from '@/lib/player/YouTubePlayer';
import type { RoomService } from '@/lib/room/RoomService';
import { settingsStore } from '@/lib/settings';
import { SyncEngine } from '@/lib/sync/SyncEngine';

interface PlayerPanelProps {
  service: RoomService;
  isHost: boolean;
}

/**
 * Embedded YouTube player wired to the room's SyncEngine, with the
 * reaction overlay/bar/timeline. The host loads videos and drives playback
 * with the player's native controls; viewers follow (ADR-006). Reactions
 * are open to everyone.
 */
export function PlayerPanel({ service, isHost }: PlayerPanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const videoIdRef = useRef<string | null>(null);
  videoIdRef.current = videoId;
  const settings = useSettings();

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
      onStateChange: (state) => engineRef.current?.handleLocalStateChange(state),
      onError: (message) => setError(message),
    });
    playerRef.current = player;

    const engine = new SyncEngine(service, player, () => isHostRef.current, {
      onVideoChanged: (id) => {
        setVideoId(id);
        setError(null);
      },
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

  // Track duration for the timeline strip (0 until a video is loaded).
  useEffect(() => {
    if (videoId === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setDurationSeconds(playerRef.current?.getDuration() ?? 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [videoId]);

  function handleLoad(event: FormEvent): void {
    event.preventDefault();
    const id = extractVideoId(url);
    if (id === null) {
      setError('That does not look like a YouTube link or video id.');
      return;
    }
    setError(null);
    engineRef.current?.loadVideo(id);
  }

  const hasVideo = videoId !== null;

  return (
    <div className="player-panel">
      {isHost ? (
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
          <button type="submit" className="button button-primary">
            Load
          </button>
        </form>
      ) : (
        <p className="player-viewer-note">The host controls playback.</p>
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

      <ReactionBar disabled={!hasVideo} onReact={send} />
    </div>
  );
}
