import { describe, expect, it, vi } from 'vitest';
import type { RealtimeEventName } from '@shared/events';
import type { QueueEntry } from '@shared/queue';
import type { RoomService } from '@/lib/room/RoomService';
import { QueueService } from '@/lib/queue/QueueService';

class FakeRoom {
  public readonly selfId = 'viewer';
  public readonly send = vi.fn(async () => {});
  private readonly listeners = new Map<string, Set<(envelope: any) => void>>();
  private readonly reconnectListeners = new Set<() => void>();

  public on(event: RealtimeEventName, listener: (envelope: any) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<(envelope: any) => void>();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  public onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  public emit(event: RealtimeEventName, data: unknown, senderId = 'host'): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener({ senderId, sentAt: Date.now(), data });
    }
  }

  public reconnect(): void {
    for (const listener of this.reconnectListeners) listener();
  }
}

const entry: QueueEntry = {
  id: 'entry-1',
  videoId: 'dQw4w9WgXcQ',
  title: 'Test video',
  addedById: 'host',
  addedByName: 'Host',
  votes: ['host'],
  addedAt: 1,
};

describe('QueueService reconciliation', () => {
  it('requests state as a viewer and re-announces the inherited snapshot after host succession', () => {
    const room = new FakeRoom();
    let host = false;
    const onChange = vi.fn();
    const service = new QueueService(
      room as unknown as RoomService,
      () => host,
      onChange,
    );

    service.start();
    expect(room.send).toHaveBeenCalledWith('sync:request', {});

    room.emit('queue:state', { entries: [entry] });
    expect(onChange).toHaveBeenLastCalledWith([entry]);

    room.send.mockClear();
    host = true;
    service.announceHostState();
    expect(room.send).toHaveBeenCalledWith('queue:state', { entries: [entry] });
    service.stop();
  });

  it('reconciles again after reconnect even when playback sync is unavailable', () => {
    const room = new FakeRoom();
    let host = false;
    const service = new QueueService(room as unknown as RoomService, () => host, vi.fn());
    service.start();
    room.send.mockClear();

    room.reconnect();
    expect(room.send).toHaveBeenCalledWith('sync:request', {});

    room.send.mockClear();
    host = true;
    room.reconnect();
    expect(room.send).toHaveBeenCalledWith('queue:state', { entries: [] });
    service.stop();
  });
});
