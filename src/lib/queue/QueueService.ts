import { isValidVideoId } from '@shared/youtube';
import {
  MAX_QUEUE_ENTRIES,
  MAX_QUEUE_TITLE_LENGTH,
  MIN_ADD_INTERVAL_MS,
  sortQueue,
  type QueueEntry,
} from '@shared/queue';
import type { RoomService } from '@/lib/room/RoomService';

export type QueueChangeListener = (entries: readonly QueueEntry[]) => void;

function isQueueEntry(value: unknown): value is QueueEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as QueueEntry;
  return (
    typeof entry.id === 'string' &&
    typeof entry.videoId === 'string' &&
    isValidVideoId(entry.videoId) &&
    typeof entry.title === 'string' &&
    typeof entry.addedById === 'string' &&
    typeof entry.addedByName === 'string' &&
    Array.isArray(entry.votes) &&
    entry.votes.every((v) => typeof v === 'string') &&
    typeof entry.addedAt === 'number'
  );
}

/**
 * Collaborative queue (ADR-013). The current host holds the canonical
 * list: add/vote/remove requests from members are applied host-side and
 * the full snapshot is rebroadcast. Everyone (host included) renders only
 * from snapshots, so all clients stay identical.
 */
export class QueueService {
  private entries: QueueEntry[] = [];
  private readonly lastAddAt = new Map<string, number>();
  private readonly unsubscribes: Array<() => void> = [];

  public constructor(
    private readonly room: RoomService,
    private readonly isHost: () => boolean,
    private readonly onChange: QueueChangeListener,
  ) {}

  public start(): void {
    this.unsubscribes.push(
      this.room.on('queue:add', ({ senderId, data }) => {
        if (this.isHost()) {
          this.applyAdd(senderId, data.videoId, data.title, data.addedByName);
        }
      }),
      this.room.on('queue:vote', ({ senderId, data }) => {
        if (this.isHost() && typeof data.entryId === 'string') {
          this.applyVote(senderId, data.entryId);
        }
      }),
      this.room.on('queue:remove', ({ senderId, data }) => {
        if (this.isHost() && typeof data.entryId === 'string') {
          this.applyRemove(senderId, data.entryId, false);
        }
      }),
      this.room.on('queue:state', ({ data }) => {
        if (!this.isHost()) {
          const entries = Array.isArray(data.entries)
            ? data.entries.filter(isQueueEntry).slice(0, MAX_QUEUE_ENTRIES)
            : [];
          this.entries = entries;
          this.onChange(this.entries);
        }
      }),
      // Late joiners ask for state; the host answers with the queue too.
      this.room.on('sync:request', () => {
        if (this.isHost()) {
          this.broadcastState();
        }
      }),
    );
  }

  public stop(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes.length = 0;
  }

  /** Add a video (any member). Returns false when rate-limited/invalid. */
  public add(videoId: string, title: string, selfName: string): boolean {
    if (!isValidVideoId(videoId)) {
      return false;
    }
    if (this.isHost()) {
      return this.applyAdd(this.room.selfId, videoId, title, selfName);
    }
    this.room.send('queue:add', { videoId, title, addedByName: selfName }).catch(() => {});
    return true;
  }

  /** Toggle own vote on an entry. */
  public vote(entryId: string): void {
    if (this.isHost()) {
      this.applyVote(this.room.selfId, entryId);
    } else {
      this.room.send('queue:vote', { entryId }).catch(() => {});
    }
  }

  /** Remove an entry (own entries; host removes any). */
  public remove(entryId: string): void {
    if (this.isHost()) {
      this.applyRemove(this.room.selfId, entryId, true);
    } else {
      this.room.send('queue:remove', { entryId }).catch(() => {});
    }
  }

  /** Host only: pop the top-voted entry for auto-advance. */
  public popNext(): QueueEntry | null {
    if (!this.isHost() || this.entries.length === 0) {
      return null;
    }
    const next = sortQueue(this.entries)[0] ?? null;
    if (next !== null) {
      this.entries = this.entries.filter((entry) => entry.id !== next.id);
      this.commit();
    }
    return next;
  }

  private applyAdd(
    senderId: string,
    videoId: unknown,
    title: unknown,
    addedByName: unknown,
  ): boolean {
    if (typeof videoId !== 'string' || !isValidVideoId(videoId)) {
      return false;
    }
    if (this.entries.length >= MAX_QUEUE_ENTRIES) {
      return false;
    }
    const now = Date.now();
    const last = this.lastAddAt.get(senderId) ?? 0;
    if (now - last < MIN_ADD_INTERVAL_MS) {
      return false;
    }
    this.lastAddAt.set(senderId, now);

    this.entries = [
      ...this.entries,
      {
        id: crypto.randomUUID(),
        videoId,
        title:
          typeof title === 'string' && title.trim().length > 0
            ? title.trim().slice(0, MAX_QUEUE_TITLE_LENGTH)
            : `youtu.be/${videoId}`,
        addedById: senderId,
        addedByName:
          typeof addedByName === 'string' ? addedByName.slice(0, 24) : 'Unknown',
        votes: [senderId],
        addedAt: now,
      },
    ];
    this.commit();
    return true;
  }

  private applyVote(senderId: string, entryId: string): void {
    this.entries = this.entries.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }
      const votes = entry.votes.includes(senderId)
        ? entry.votes.filter((id) => id !== senderId)
        : [...entry.votes, senderId];
      return { ...entry, votes };
    });
    this.commit();
  }

  private applyRemove(senderId: string, entryId: string, senderIsHost: boolean): void {
    this.entries = this.entries.filter(
      (entry) => entry.id !== entryId || (!senderIsHost && entry.addedById !== senderId),
    );
    this.commit();
  }

  private commit(): void {
    this.onChange(this.entries);
    this.broadcastState();
  }

  private broadcastState(): void {
    this.room.send('queue:state', { entries: this.entries }).catch(() => {});
  }
}
