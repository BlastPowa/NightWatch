import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, EventPayload, RealtimeEventName } from '@shared/events';
import type { YouTubePlayer } from '@/lib/player/YouTubePlayer';
import type { RoomService } from '@/lib/room/RoomService';
import { SyncEngine } from '@/lib/sync/SyncEngine';

type Listener = (envelope: EventEnvelope<EventPayload<RealtimeEventName>>) => void;

class FakeRoom {
  public readonly send = vi.fn(async () => {});
  private readonly listeners = new Map<RealtimeEventName, Set<Listener>>();
  private readonly reconnectListeners = new Set<() => void>();

  public on<E extends RealtimeEventName>(
    event: E,
    listener: (envelope: EventEnvelope<EventPayload<E>>) => void,
  ): () => void {
    let listeners = this.listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as Listener);
    return () => listeners?.delete(listener as Listener);
  }

  public onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  public emit<E extends RealtimeEventName>(event: E, data: EventPayload<E>): void {
    const envelope = { senderId: 'host', sentAt: Date.now(), data } as EventEnvelope<
      EventPayload<RealtimeEventName>
    >;
    this.listeners.get(event)?.forEach((listener) => listener(envelope));
  }

  public reconnect(): void {
    this.reconnectListeners.forEach((listener) => listener());
  }
}

function player(): YouTubePlayer {
  return {
    loadVideo: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 10),
    getState: vi.fn(() => 'paused'),
  } as unknown as YouTubePlayer;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SyncEngine reconnect recovery', () => {
  it('requests a fresh snapshot again after reconnect', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const room = new FakeRoom();
    const engine = new SyncEngine(
      room as unknown as RoomService,
      player(),
      () => false,
    );

    engine.start();
    expect(room.send).toHaveBeenCalledWith('sync:request', {});

    room.emit('sync:state', {
      videoId: null,
      positionSeconds: 0,
      isPlaying: false,
      hostClockMs: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(room.send).toHaveBeenCalledTimes(1);

    room.reconnect();
    expect(room.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(room.send).toHaveBeenCalledTimes(3);

    room.emit('sync:state', {
      videoId: null,
      positionSeconds: 0,
      isPlaying: false,
      hostClockMs: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(room.send).toHaveBeenCalledTimes(3);
    engine.stop();
  });
});
