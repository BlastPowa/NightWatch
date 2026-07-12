import { describe, expect, it } from 'vitest';
import { MAX_QUEUE_ENTRIES, sortQueue, type QueueEntry } from './queue';

const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  id: 'e1',
  videoId: 'dQw4w9WgXcQ',
  title: 'A video',
  addedById: 'u1',
  addedByName: 'Someone',
  votes: [],
  addedAt: 1000,
  ...over,
});

describe('sortQueue', () => {
  it('puts the most-voted entry first', () => {
    const order = sortQueue([
      entry({ id: 'one', votes: ['a'] }),
      entry({ id: 'three', votes: ['a', 'b', 'c'] }),
      entry({ id: 'two', votes: ['a', 'b'] }),
    ]);
    expect(order.map((e) => e.id)).toEqual(['three', 'two', 'one']);
  });

  it('breaks a tie by who was added first, not by chance', () => {
    // Everyone in the room sorts the same broadcast state independently, so an
    // unstable tiebreak means two clients disagree about what plays next.
    const order = sortQueue([
      entry({ id: 'later', votes: ['a'], addedAt: 3000 }),
      entry({ id: 'earlier', votes: ['b'], addedAt: 1000 }),
      entry({ id: 'middle', votes: ['c'], addedAt: 2000 }),
    ]);
    expect(order.map((e) => e.id)).toEqual(['earlier', 'middle', 'later']);
  });

  it('is deterministic — the same input always yields the same order', () => {
    const entries = [
      entry({ id: 'a', votes: ['x'], addedAt: 1000 }),
      entry({ id: 'b', votes: ['y'], addedAt: 1000 }),
      entry({ id: 'c', votes: ['z'], addedAt: 1000 }),
    ];
    const first = sortQueue(entries).map((e) => e.id);
    for (let i = 0; i < 20; i++) {
      expect(sortQueue(entries).map((e) => e.id)).toEqual(first);
    }
  });

  it('does not mutate the array it was given', () => {
    // The caller holds broadcast state. Sorting it in place would reorder what
    // every other client is also reading.
    const entries = [
      entry({ id: 'low', votes: [] }),
      entry({ id: 'high', votes: ['a', 'b'] }),
    ];
    const snapshot = entries.map((e) => e.id);
    sortQueue(entries);
    expect(entries.map((e) => e.id)).toEqual(snapshot);
  });

  it('handles the empty and single-entry cases', () => {
    expect(sortQueue([])).toEqual([]);
    expect(sortQueue([entry({ id: 'only' })]).map((e) => e.id)).toEqual(['only']);
  });

  it('sorts a full queue correctly', () => {
    const entries = Array.from({ length: MAX_QUEUE_ENTRIES }, (_, i) =>
      entry({ id: `e${i}`, votes: Array.from({ length: i % 5 }, (_, v) => `v${v}`), addedAt: i }),
    );
    const order = sortQueue(entries);
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1]!;
      const curr = order[i]!;
      const ordered =
        prev.votes.length > curr.votes.length ||
        (prev.votes.length === curr.votes.length && prev.addedAt <= curr.addedAt);
      expect(ordered).toBe(true);
    }
  });
});
