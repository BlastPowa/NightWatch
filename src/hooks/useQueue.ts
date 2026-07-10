import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sortQueue, type QueueEntry } from '@shared/queue';
import { QueueService } from '@/lib/queue/QueueService';
import type { RoomService } from '@/lib/room/RoomService';

export interface QueueBinding {
  /** Entries in play order (votes desc, oldest first). */
  entries: readonly QueueEntry[];
  add(videoId: string, title: string, selfName: string): boolean;
  vote(entryId: string): void;
  remove(entryId: string): void;
  /** Host only: take the next entry (removes it from the queue). */
  popNext(): QueueEntry | null;
}

/** Binds a QueueService to React state for the lifetime of the room. */
export function useQueue(service: RoomService, isHost: boolean): QueueBinding {
  const [entries, setEntries] = useState<readonly QueueEntry[]>([]);
  const queueRef = useRef<QueueService | null>(null);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  useEffect(() => {
    const queue = new QueueService(service, () => isHostRef.current, setEntries);
    queueRef.current = queue;
    queue.start();
    return () => {
      queueRef.current = null;
      queue.stop();
      setEntries([]);
    };
  }, [service]);

  const add = useCallback((videoId: string, title: string, selfName: string): boolean => {
    return queueRef.current?.add(videoId, title, selfName) ?? false;
  }, []);

  const vote = useCallback((entryId: string): void => {
    queueRef.current?.vote(entryId);
  }, []);

  const remove = useCallback((entryId: string): void => {
    queueRef.current?.remove(entryId);
  }, []);

  const popNext = useCallback((): QueueEntry | null => {
    return queueRef.current?.popNext() ?? null;
  }, []);

  const sorted = useMemo(() => sortQueue(entries), [entries]);

  return { entries: sorted, add, vote, remove, popNext };
}
