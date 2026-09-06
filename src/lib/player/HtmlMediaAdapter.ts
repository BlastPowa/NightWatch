import {
  deriveSourceKey,
  mediaFail,
  mediaOk,
  type HtmlMediaSourceDescriptor,
  type MediaResult,
  type MediaSourceDescriptor,
} from '@shared/media';
import type {
  PlaybackAdapter,
  PlaybackAdapterEvent,
  PlaybackSnapshotV1,
} from '@shared/mediaPlayback';
import type { PlaybackLease } from '@shared/mediaBridge';

type LeaseResolver = (
  descriptor: HtmlMediaSourceDescriptor,
) => Promise<MediaResult<PlaybackLease>>;

/**
 * Source-neutral HTML video adapter.
 *
 * The renderer receives only a short-lived private protocol URL. File paths,
 * Drive tokens, and provider responses remain in Electron main.
 */
export class HtmlMediaAdapter implements PlaybackAdapter {
  public readonly kind: 'local' | 'drive';

  private lease: PlaybackLease | null = null;
  private descriptor: HtmlMediaSourceDescriptor | null = null;
  private listeners = new Set<(event: PlaybackAdapterEvent) => void>();
  private sessionId: string | null = null;
  private sourceKey: string | null = null;
  private revision = 0;
  private destroyed = false;

  public constructor(
    private readonly video: HTMLVideoElement,
    kind: 'local' | 'drive',
    private readonly resolveLease: LeaseResolver,
    private readonly releaseLease: (leaseId: string) => Promise<void>,
  ) {
    this.kind = kind;
    video.addEventListener('loadedmetadata', this.onReady);
    video.addEventListener('playing', this.onState);
    video.addEventListener('pause', this.onState);
    video.addEventListener('waiting', this.onBuffering);
    video.addEventListener('ended', this.onEnded);
    video.addEventListener('error', this.onError);
  }

  public setSession(sessionId: string, descriptor: HtmlMediaSourceDescriptor, revision = 0): void {
    this.sessionId = sessionId;
    this.sourceKey = deriveSourceKey(descriptor);
    this.revision = revision;
  }

  public setRevision(revision: number): void {
    this.revision = Math.max(this.revision, revision);
  }

  public async load(source: MediaSourceDescriptor): Promise<MediaResult<void>> {
    if (source.kind === 'youtube' || source.kind !== this.kind) {
      return mediaFail('source-mismatch', 'The selected media source does not match this player.');
    }
    await this.clearLease();
    const lease = await this.resolveLease(source);
    if (!lease.ok) {
      return lease;
    }
    if (this.destroyed) {
      await this.releaseLease(lease.value.leaseId);
      return mediaFail('aborted', 'Media loading was cancelled.');
    }
    this.lease = lease.value;
    this.descriptor = source;
    this.video.src = lease.value.playbackUrl;
    this.video.load();
    return mediaOk(undefined);
  }

  public async play(): Promise<MediaResult<void>> {
    try {
      await this.video.play();
      return mediaOk(undefined);
    } catch {
      return mediaFail('internal', 'Playback could not start on this device.');
    }
  }

  public async pause(): Promise<MediaResult<void>> {
    this.video.pause();
    return mediaOk(undefined);
  }

  public async seek(positionSeconds: number): Promise<MediaResult<void>> {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      return mediaFail('invalid-request', 'The requested playback position is invalid.');
    }
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : positionSeconds;
    this.video.currentTime = Math.min(positionSeconds, duration);
    return mediaOk(undefined);
  }

  public setVolume(volumePercent: number): void {
    this.video.volume = Math.max(0, Math.min(1, volumePercent / 100));
  }

  public getSnapshot(): PlaybackSnapshotV1 | null {
    if (
      this.sessionId === null ||
      this.sourceKey === null ||
      this.descriptor === null
    ) {
      return null;
    }
    return {
      protocolVersion: 1,
      sessionId: this.sessionId,
      sourceKey: this.sourceKey,
      positionSeconds: Math.max(0, this.video.currentTime || 0),
      durationSeconds: Number.isFinite(this.video.duration) ? this.video.duration : null,
      paused: this.video.paused,
      playbackRate: this.video.playbackRate,
      hostClockMs: Date.now(),
      revision: this.revision,
    };
  }

  public subscribe(listener: (event: PlaybackAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public destroy(): void {
    this.destroyed = true;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.removeEventListener('loadedmetadata', this.onReady);
    this.video.removeEventListener('playing', this.onState);
    this.video.removeEventListener('pause', this.onState);
    this.video.removeEventListener('waiting', this.onBuffering);
    this.video.removeEventListener('ended', this.onEnded);
    this.video.removeEventListener('error', this.onError);
    this.listeners.clear();
    void this.clearLease();
  }

  private readonly onReady = (): void => {
    this.emit({
      type: 'ready',
      durationSeconds: Number.isFinite(this.video.duration) ? this.video.duration : null,
    });
  };

  private readonly onState = (): void => {
    const snapshot = this.getSnapshot();
    if (snapshot !== null) {
      this.emit({ type: 'state', snapshot });
    }
  };

  private readonly onBuffering = (): void => {
    this.emit({ type: 'buffering' });
  };

  private readonly onEnded = (): void => {
    this.emit({ type: 'ended' });
  };

  private readonly onError = (): void => {
    this.emit({
      type: 'error',
      error: {
        code: 'unsupported-codec',
        message: 'This device could not decode the selected video.',
        retryable: false,
      },
    });
  };

  private emit(event: PlaybackAdapterEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private async clearLease(): Promise<void> {
    const lease = this.lease;
    this.lease = null;
    this.descriptor = null;
    if (lease !== null) {
      await this.releaseLease(lease.leaseId);
    }
  }
}
