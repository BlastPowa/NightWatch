import { useEffect, useRef, useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import { YouTubePlayer } from '@/lib/player/YouTubePlayer';
import type { RoomService } from '@/lib/room/RoomService';
import { SyncEngine } from '@/lib/sync/SyncEngine';

interface PlayerPanelProps {
  service: RoomService;
  isHost: boolean;
}

/**
 * Embedded YouTube player wired to the room's SyncEngine. The host loads
 * videos and drives playback with the player's native controls; viewers
 * follow automatically (ADR-006).
 */
export function PlayerPanel({ service, isHost }: PlayerPanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const mountPoint = document.createElement('div');
    container.appendChild(mountPoint);

    const player = new YouTubePlayer({
      onStateChange: (state) => engineRef.current?.handleLocalStateChange(state),
      onError: (message) => setError(message),
    });

    const engine = new SyncEngine(service, player, () => isHostRef.current, {
      onVideoChanged: () => {
        setHasVideo(true);
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
      engine.stop();
      player.destroy();
      container.replaceChildren();
    };
  }, [service]);

  function handleLoad(event: FormEvent): void {
    event.preventDefault();
    const videoId = extractVideoId(url);
    if (videoId === null) {
      setError('That does not look like a YouTube link or video id.');
      return;
    }
    setError(null);
    setHasVideo(true);
    engineRef.current?.loadVideo(videoId);
  }

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

      <div className={`player-frame${hasVideo ? '' : ' player-frame-empty'}`}>
        <div ref={containerRef} className="player-mount" />
        {!hasVideo && (
          <span className="player-placeholder">
            {isHost ? 'No video loaded' : 'Waiting for the host to pick a video…'}
          </span>
        )}
      </div>
    </div>
  );
}
