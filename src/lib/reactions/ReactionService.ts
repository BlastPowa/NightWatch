import { isReactionEmoji, type ReactionEmoji, type ReactionStamp } from '@shared/reactions';
import type { RoomService } from '@/lib/room/RoomService';

/** Where in playback a reaction should be stamped. */
export interface ReactionContext {
  videoId: string | null;
  positionSeconds: number;
}

export type ReactionListener = (stamp: ReactionStamp) => void;

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
  public send(emoji: ReactionEmoji): void {
    const now = Date.now();
    if (now - this.lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }
    const { videoId, positionSeconds } = this.getContext();
    if (videoId === null) {
      return;
    }
    this.lastSentAt = now;

    // Show own reaction immediately (broadcast self=false).
    this.onStamp({
      id: crypto.randomUUID(),
      emoji,
      videoId,
      positionSeconds,
      senderId: this.room.selfId,
      at: now,
    });
    this.room.send('reaction:stamp', { emoji, videoId, positionSeconds }).catch(() => {
      // Ephemeral fire-and-forget; a lost reaction is acceptable.
    });
  }
}
