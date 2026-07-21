import { isReactionEmoji, type ReactionEmoji, type ReactionStamp } from '@shared/reactions';
import { sessionRecorder } from '@/lib/analytics/SessionRecorder';
import type { RoomService } from '@/lib/room/RoomService';

/** Where in playback a reaction should be stamped. */
export interface ReactionContext {
  videoId: string | null;
  positionSeconds: number;
}

export type ReactionListener = (stamp: ReactionStamp) => void;
export type ReactionSendResult = 'ok' | 'no-video' | 'rate-limited' | 'disconnected' | 'failed';

const MIN_SEND_INTERVAL_MS = 250;

/**
 * Sends and receives reaction stamps on the room channel. Incoming emojis
 * are validated against the palette so arbitrary payloads never reach the
 * UI. Storage/animation is the hook's concern; this class is transport.
 */
export class ReactionService {
  private lastSentAt = 0;
  private unsubscribe: (() => void) | null = null;

  public constructor(
    private readonly room: RoomService,
    private readonly getContext: () => ReactionContext,
    private readonly onStamp: ReactionListener,
  ) {}

  public start(): void {
    this.unsubscribe = this.room.on('reaction:stamp', (envelope) => {
      const { emoji, videoId, positionSeconds } = envelope.data;
      if (!isReactionEmoji(emoji) || typeof videoId !== 'string') {
        return;
      }
      this.onStamp({
        id: crypto.randomUUID(),
        emoji,
        videoId,
        positionSeconds,
        senderId: envelope.senderId,
        at: envelope.sentAt,
      });
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** React at the current playback moment. No-op without a loaded video. */
  public async send(emoji: ReactionEmoji): Promise<ReactionSendResult> {
    const now = Date.now();
    if (now - this.lastSentAt < MIN_SEND_INTERVAL_MS) {
      return 'rate-limited';
    }
    const { videoId, positionSeconds } = this.getContext();
    if (videoId === null) {
      return 'no-video';
    }
    this.lastSentAt = now;

    try {
      await this.room.send('reaction:stamp', { emoji, videoId, positionSeconds });
    } catch (error) {
      return error instanceof Error && error.message.includes('Not connected')
        ? 'disconnected'
        : 'failed';
    }
    // Show own reaction after the transport accepts it (broadcast self=false).
    this.onStamp({
      id: crypto.randomUUID(),
      emoji,
      videoId,
      positionSeconds,
      senderId: this.room.selfId,
      at: now,
    });
    // Opt-in insights (Phase 17): no-ops unless recording (host + enabled).
    sessionRecorder.reaction(positionSeconds);
    return 'ok';
  }
}
