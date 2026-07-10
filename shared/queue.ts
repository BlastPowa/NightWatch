/**
 * Collaborative queue domain (Phase 15, ADR-013). The queue is synced
 * Broadcast state — host-authoritative like playback (ADR-006) — and
 * ephemeral: it lives only while the room does.
 */

export const MAX_QUEUE_ENTRIES = 50;
export const MAX_QUEUE_TITLE_LENGTH = 120;
export const MIN_ADD_INTERVAL_MS = 5000;

export interface QueueEntry {
  id: string;
  videoId: string;
  title: string;
  addedById: string;
  addedByName: string;
  /** Member ids who upvoted (adder auto-votes). */
  votes: string[];
  addedAt: number;
}

/** Play order: most votes first, ties broken by oldest add. */
export function sortQueue(entries: readonly QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) =>
    b.votes.length !== a.votes.length ? b.votes.length - a.votes.length : a.addedAt - b.addedAt,
  );
}
