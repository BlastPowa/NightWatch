import type { RealtimeEventMap } from '@shared/events';
import type { PlayerState } from '@/lib/player/types';
import type { YouTubePlayer } from '@/lib/player/YouTubePlayer';
import type { RoomService } from '@/lib/room/RoomService';

/** Host's authoritative playback snapshot, as last received by a viewer. */
interface ExpectedPlayback {
  positionSeconds: number;
  isPlaying: boolean;
  hostClockMs: number;
}

export interface SyncEngineCallbacks {
  /** Fired when a video becomes active (locally or from the host). */
  onVideoChanged?(videoId: string): void;
}

const DRIFT_CHECK_INTERVAL_MS = 5000;
const DRIFT_TOLERANCE_SECONDS = 1.5;
const SEEK_TOLERANCE_SECONDS = 1;
const SYNC_REQUEST_INTERVAL_MS = 2000;
const REMOTE_APPLY_SUPPRESS_MS = 800;

/**
 * Synchronizes playback state across a room (ADR-003: state, not streams).
 *
 * Host: observes the local player's state changes (so YouTube's native
 * controls drive sync directly) and broadcasts them; answers sync requests.
 * Viewer: applies host commands to the local player, corrects drift every
 * few seconds, and requests state on join until the host answers.
 *
 * Host-only control is enforced client-side per ADR-006: viewers never
 * broadcast playback events. Host status is read live via isHost() so
 * host migration works without re-wiring.
 */
export class SyncEngine {
  private currentVideoId: string | null = null;
  private expected: ExpectedPlayback | null = null;
  private pendingSnapshot: RealtimeEventMap['sync:state'] | null = null;
  private suppressLocalUntil = 0;
  private hasHostSnapshot = false;
  private driftTimer: number | null = null;
  private syncRequestTimer: number | null = null;
  private readonly unsubscribes: Array<() => void> = [];

  public constructor(
    private readonly room: RoomService,
    private readonly player: YouTubePlayer,
    private readonly isHost: () => boolean,
    private readonly callbacks: SyncEngineCallbacks = {},
  ) {}

  public start(): void {
    this.unsubscribes.push(
      this.room.on('playback:load', ({ data }) => {
        if (!this.isHost()) {
          this.applyLoad(data.videoId);
        }
      }),
      this.room.on('playback:play', ({ data }) => {
        if (!this.isHost()) {
          this.applyPlay(data.positionSeconds, data.hostClockMs);
        }
      }),
      this.room.on('playback:pause', ({ data }) => {
        if (!this.isHost()) {
          this.applyPause(data.positionSeconds);
        }
      }),
      this.room.on('sync:request', () => {
        if (this.isHost()) {
          void this.sendSnapshot();
        }
      }),
      this.room.on('sync:state', ({ data }) => {
        if (!this.isHost()) {
          this.applySnapshot(data);
        }
      }),
    );

    this.driftTimer = window.setInterval(() => this.correctDrift(), DRIFT_CHECK_INTERVAL_MS);

    // Ask the host for state until an answer arrives (join/reconnect).
    this.syncRequestTimer = window.setInterval(() => {
      if (this.isHost() || this.hasHostSnapshot) {
        this.stopSyncRequests();
        return;
      }
      this.room.send('sync:request', {}).catch(() => {
        // Channel not ready yet — next tick retries.
      });
    }, SYNC_REQUEST_INTERVAL_MS);
  }

  public stop(): void {
    if (this.driftTimer !== null) {
      window.clearInterval(this.driftTimer);
      this.driftTimer = null;
    }
    this.stopSyncRequests();
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes.length = 0;
  }

  /** Host UI action: load a video locally and broadcast it to the room. */
  public loadVideo(videoId: string): void {
    this.currentVideoId = videoId;
    this.player.loadVideo(videoId);
    this.callbacks.onVideoChanged?.(videoId);
    if (this.isHost()) {
      this.room.send('playback:load', { videoId }).catch(() => {
        // Broadcast failed (e.g. reconnecting); drift/sync flow recovers.
      });
    }
  }

  /** Wire the player's onStateChange here. */
  public handleLocalStateChange(state: PlayerState): void {
    if (!this.isHost()) {
      if (this.pendingSnapshot !== null && (state === 'playing' || state === 'paused')) {
        this.applyPendingSnapshot();
      }
      return;
    }

    if (Date.now() < this.suppressLocalUntil) {
      return;
    }

    if (state === 'playing') {
      this.room
        .send('playback:play', {
          positionSeconds: this.player.getCurrentTime(),
          hostClockMs: Date.now(),
        })
        .catch(() => {});
    } else if (state === 'paused') {
      this.room
        .send('playback:pause', { positionSeconds: this.player.getCurrentTime() })
        .catch(() => {});
    }
  }

  private async sendSnapshot(): Promise<void> {
    try {
      await this.room.send('sync:state', {
        videoId: this.currentVideoId,
        positionSeconds: this.player.getCurrentTime(),
        isPlaying: this.player.getState() === 'playing',
        hostClockMs: Date.now(),
      });
    } catch {
      // Requester will retry.
    }
  }

  private applyLoad(videoId: string): void {
    this.currentVideoId = videoId;
    this.expected = null;
    this.suppress();
    this.player.loadVideo(videoId);
    this.callbacks.onVideoChanged?.(videoId);
  }

  private applyPlay(positionSeconds: number, hostClockMs: number): void {
    this.hasHostSnapshot = true;
    this.expected = { positionSeconds, isPlaying: true, hostClockMs };
    this.suppress();
    const target = positionSeconds + (Date.now() - hostClockMs) / 1000;
    if (Math.abs(this.player.getCurrentTime() - target) > SEEK_TOLERANCE_SECONDS) {
      this.player.seekTo(target);
    }
    this.player.play();
  }

  private applyPause(positionSeconds: number): void {
    this.hasHostSnapshot = true;
    this.expected = { positionSeconds, isPlaying: false, hostClockMs: Date.now() };
    this.suppress();
    this.player.pause();
    if (Math.abs(this.player.getCurrentTime() - positionSeconds) > SEEK_TOLERANCE_SECONDS) {
      this.player.seekTo(positionSeconds);
    }
  }

  private applySnapshot(snapshot: RealtimeEventMap['sync:state']): void {
    this.hasHostSnapshot = true;
    this.stopSyncRequests();

    if (snapshot.videoId === null) {
      return;
    }

    if (snapshot.videoId !== this.currentVideoId) {
      this.currentVideoId = snapshot.videoId;
      this.pendingSnapshot = snapshot;
      this.suppress();
      this.player.loadVideo(snapshot.videoId);
      this.callbacks.onVideoChanged?.(snapshot.videoId);
      return;
    }

    if (snapshot.isPlaying) {
      this.applyPlay(snapshot.positionSeconds, snapshot.hostClockMs);
    } else {
      this.applyPause(snapshot.positionSeconds);
    }
  }

  /** Applied once the newly loaded video actually starts (player ready). */
  private applyPendingSnapshot(): void {
    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = null;
    if (snapshot === null) {
      return;
    }
    if (snapshot.isPlaying) {
      this.applyPlay(snapshot.positionSeconds, snapshot.hostClockMs);
    } else {
      this.applyPause(snapshot.positionSeconds);
    }
  }

  private correctDrift(): void {
    if (this.isHost() || this.expected === null || !this.expected.isPlaying) {
      return;
    }
    const target =
      this.expected.positionSeconds + (Date.now() - this.expected.hostClockMs) / 1000;
    if (Math.abs(this.player.getCurrentTime() - target) > DRIFT_TOLERANCE_SECONDS) {
      this.suppress();
      this.player.seekTo(target);
    }
  }

  private stopSyncRequests(): void {
    if (this.syncRequestTimer !== null) {
      window.clearInterval(this.syncRequestTimer);
      this.syncRequestTimer = null;
    }
  }

  private suppress(): void {
    this.suppressLocalUntil = Date.now() + REMOTE_APPLY_SUPPRESS_MS;
  }
}
