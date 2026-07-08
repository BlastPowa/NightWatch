import { loadYouTubeApi } from '@/lib/player/youtubeApi';
import {
  playerErrorMessage,
  toPlayerState,
  type PlayerEvents,
  type PlayerState,
} from '@/lib/player/types';

/**
 * Abstraction over the official YouTube IFrame player. All feature code
 * (and Phase 5's SyncEngine) programs against this class — YT.Player
 * never leaks out. Playback state is only observed and controlled through
 * official API methods (COMPLIANCE).
 */
export class YouTubePlayer {
  private player: YT.Player | null = null;
  private isReady = false;
  private destroyed = false;
  private pendingVideoId: string | null = null;

  public constructor(private readonly events: PlayerEvents = {}) {}

  /** Create the underlying iframe player inside the given container. */
  public async mount(container: HTMLElement): Promise<void> {
    const api = await loadYouTubeApi();
    if (this.destroyed) {
      return;
    }

    this.player = new api.Player(container, {
      width: '100%',
      height: '100%',
      playerVars: {
        playsinline: 1,
        rel: 0,
        origin: window.location.origin.startsWith('http') ? window.location.origin : undefined,
      },
      events: {
        onReady: () => {
          this.isReady = true;
          if (this.pendingVideoId !== null) {
            const videoId = this.pendingVideoId;
            this.pendingVideoId = null;
            this.player?.loadVideoById(videoId);
          }
          this.events.onReady?.();
        },
        onStateChange: (event) => {
          this.events.onStateChange?.(toPlayerState(event.data));
        },
        onError: (event) => {
          this.events.onError?.(playerErrorMessage(event.data));
        },
      },
    });
  }

  /** Load and start playing a video. Queued if the player isn't ready yet. */
  public loadVideo(videoId: string): void {
    if (!this.isReady || this.player === null) {
      this.pendingVideoId = videoId;
      return;
    }
    this.player.loadVideoById(videoId);
  }

  public play(): void {
    this.player?.playVideo();
  }

  public pause(): void {
    this.player?.pauseVideo();
  }

  public seekTo(seconds: number): void {
    this.player?.seekTo(seconds, true);
  }

  public getCurrentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }

  public getDuration(): number {
    return this.player?.getDuration() ?? 0;
  }

  public getState(): PlayerState {
    if (this.player === null || !this.isReady) {
      return 'unstarted';
    }
    return toPlayerState(this.player.getPlayerState());
  }

  /** Destroy the iframe and release resources. The instance is single-use. */
  public destroy(): void {
    this.destroyed = true;
    this.isReady = false;
    this.pendingVideoId = null;
    this.player?.destroy();
    this.player = null;
  }
}
