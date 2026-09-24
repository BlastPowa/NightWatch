import { describe, expect, it, vi } from 'vitest';
import type { RealtimeEventName } from '@shared/events';
import type { PresenceMeta } from '@shared/room';
import type { GuestIdentity } from '@/lib/identity';
import type { JoinOptions, RealtimeService, ChannelHandle } from '@/lib/realtime/RealtimeService';
import type { ConnectionStatus, ConnectionStatusListener } from '@/lib/realtime/types';
import { RoomService } from '@/lib/room/RoomService';

class FakeRealtime {
  public statusListener: ConnectionStatusListener | undefined;
  public options: JoinOptions | undefined;
  public presence: Record<string, PresenceMeta[]> = {};
  public readonly track = vi.fn(async () => {});
  public readonly send = vi.fn(async () => {});

  public join(
    _topic: string,
    onStatusChange?: ConnectionStatusListener,
    options?: JoinOptions,
  ): ChannelHandle {
    this.statusListener = onStatusChange;
    this.options = options;
    return {
      topic: 'test',
      send: this.send,
      track: this.track,
      presenceState: <TMeta>() => this.presence as unknown as Record<string, TMeta[]>,
      leave: vi.fn(async () => {}),
    };
  }

  public status(status: ConnectionStatus): void {
    this.statusListener?.(status);
  }

  public broadcast(event: RealtimeEventName, envelope: unknown): void {
    this.options?.broadcastListeners?.find((listener) => listener.event === event)?.callback(envelope);
  }
}

function identity(id: string): GuestIdentity {
  return { id, displayName: id };
}

describe('RoomService', () => {
  it('rejects host-authoritative state sent by a non-host member', () => {
    const realtime = new FakeRealtime();
    const service = new RoomService(
      realtime as unknown as RealtimeService,
      identity('viewer'),
      'ABC234',
      vi.fn(),
    );
    const playback = vi.fn();
    service.on('playback:play', playback);
    service.join();

    realtime.presence = {
      host: [{ memberId: 'host', displayName: 'Host', joinedAt: 1 }],
      viewer: [{ memberId: 'viewer', displayName: 'Viewer', joinedAt: 2 }],
    };
    realtime.options?.onPresenceSync?.();

    realtime.broadcast('playback:play', {
      senderId: 'viewer',
      sentAt: Date.now(),
      data: { positionSeconds: 12, hostClockMs: Date.now() },
    });
    expect(playback).not.toHaveBeenCalled();

    realtime.broadcast('playback:play', {
      senderId: 'host',
      sentAt: Date.now(),
      data: { positionSeconds: 12, hostClockMs: Date.now() },
    });
    expect(playback).toHaveBeenCalledTimes(1);
  });

  it('applies the shared custom-media host-authority policy at the room boundary', () => {
    const realtime = new FakeRealtime();
    const service = new RoomService(
      realtime as unknown as RealtimeService,
      identity('viewer'),
      'ABC234',
      vi.fn(),
    );
    const mediaLoad = vi.fn();
    service.on('media:v1:load', mediaLoad);
    service.join();

    realtime.presence = {
      host: [{ memberId: 'host', displayName: 'Host', joinedAt: 1 }],
      viewer: [{ memberId: 'viewer', displayName: 'Viewer', joinedAt: 2 }],
    };
    realtime.options?.onPresenceSync?.();

    const data = {
      sessionId: 'session_1234',
      source: {
        kind: 'local-file' as const,
        sourceKey: `sha256:${'a'.repeat(64)}:1234`,
        displayName: 'Movie.mp4',
        sizeBytes: 1234,
        mimeType: 'video/mp4',
      },
      revision: 1,
    };

    realtime.broadcast('media:v1:load', {
      senderId: 'viewer',
      sentAt: Date.now(),
      data,
    });
    expect(mediaLoad).not.toHaveBeenCalled();

    realtime.broadcast('media:v1:load', {
      senderId: 'host',
      sentAt: Date.now(),
      data,
    });
    expect(mediaLoad).toHaveBeenCalledTimes(1);
  });

  it('notifies reconnect listeners only after a previously joined channel reconnects', () => {
    const realtime = new FakeRealtime();
    const service = new RoomService(
      realtime as unknown as RealtimeService,
      identity('viewer'),
      'ABC234',
      vi.fn(),
    );
    const reconnected = vi.fn();
    service.onReconnect(reconnected);
    service.join();

    realtime.status('connected');
    expect(reconnected).not.toHaveBeenCalled();
    realtime.status('connecting');
    realtime.status('connected');
    expect(reconnected).toHaveBeenCalledTimes(1);
  });
});
