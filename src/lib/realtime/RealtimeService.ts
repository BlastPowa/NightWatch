import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { EventEnvelope, EventPayload, RealtimeEventName } from '@shared/events';
import { supabase } from '@/lib/supabase';
import type { ConnectionStatus, ConnectionStatusListener } from '@/lib/realtime/types';

export interface JoinOptions {
  /** Stable key identifying this client in the channel's Presence state. */
  presenceKey?: string;
  /**
   * Fired whenever the channel's presence state syncs. Must be provided at
   * join time — Supabase requires presence listeners to be registered
   * before subscribe().
   */
  onPresenceSync?: () => void;
  /**
   * Broadcast bindings, also required at join time for the same reason.
   * Each callback receives the raw envelope for its event.
   */
  broadcastListeners?: ReadonlyArray<{
    event: string;
    callback: (envelope: unknown) => void;
  }>;
}

/**
 * A joined realtime channel. Obtained from RealtimeService.join and valid
 * until leave() is called.
 */
export interface ChannelHandle {
  readonly topic: string;
  /** Broadcast a typed event, wrapped in an EventEnvelope, to the channel. */
  send<E extends RealtimeEventName>(
    event: E,
    senderId: string,
    data: EventPayload<E>,
  ): Promise<void>;
  /** Publish this client's presence metadata to the channel. */
  track(meta: Record<string, unknown>): Promise<void>;
  /** Current presence state, keyed by presence key. */
  presenceState<TMeta>(): Record<string, TMeta[]>;
  /** Unsubscribe and release the channel. The handle must not be used after. */
  leave(): Promise<void>;
}

function toConnectionStatus(
  status: 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR',
): ConnectionStatus {
  switch (status) {
    case 'SUBSCRIBED':
      return 'connected';
    case 'TIMED_OUT':
    case 'CHANNEL_ERROR':
      return 'error';
    case 'CLOSED':
      return 'disconnected';
  }
}

/**
 * Thin, typed wrapper over Supabase Realtime channels. All channel
 * join/leave/broadcast/presence traffic in the app goes through this
 * service so the Supabase SDK never leaks into feature code.
 */
export class RealtimeService {
  private readonly channels = new Map<string, RealtimeChannel>();

  public constructor(private readonly client: SupabaseClient) {}

  /**
   * Join (or re-join) a channel by topic. Joining a topic that is already
   * joined returns a handle to the existing channel.
   */
  public join(
    topic: string,
    onStatusChange?: ConnectionStatusListener,
    options?: JoinOptions,
  ): ChannelHandle {
    const existing = this.channels.get(topic);
    const channel =
      existing ??
      this.client.channel(topic, {
        config: {
          broadcast: { self: false, ack: true },
          presence: { key: options?.presenceKey ?? '' },
        },
      });

    if (!existing) {
      this.channels.set(topic, channel);
      // Presence and broadcast listeners must be attached before subscribe().
      if (options?.onPresenceSync) {
        channel.on('presence', { event: 'sync' }, options.onPresenceSync);
      }
      for (const { event, callback } of options?.broadcastListeners ?? []) {
        channel.on('broadcast', { event }, (message) => {
          callback(message['payload']);
        });
      }
      onStatusChange?.('connecting');
      channel.subscribe((status) => {
        onStatusChange?.(toConnectionStatus(status));
      });
    }

    return this.createHandle(topic, channel);
  }

  private createHandle(topic: string, channel: RealtimeChannel): ChannelHandle {
    return {
      topic,
      send: async <E extends RealtimeEventName>(
        event: E,
        senderId: string,
        data: EventPayload<E>,
      ): Promise<void> => {
        const envelope: EventEnvelope<EventPayload<E>> = {
          senderId,
          sentAt: Date.now(),
          data,
        };
        const result = await channel.send({ type: 'broadcast', event, payload: envelope });
        if (result !== 'ok') {
          throw new Error(`Broadcast of "${event}" on "${topic}" failed: ${result}`);
        }
      },
      track: async (meta: Record<string, unknown>): Promise<void> => {
        const result = await channel.track(meta);
        if (result !== 'ok') {
          throw new Error(`Presence track on "${topic}" failed: ${result}`);
        }
      },
      presenceState: <TMeta>(): Record<string, TMeta[]> => {
        return channel.presenceState() as unknown as Record<string, TMeta[]>;
      },
      leave: async (): Promise<void> => {
        this.channels.delete(topic);
        await this.client.removeChannel(channel);
      },
    };
  }
}

/** App-wide singleton realtime service. */
export const realtimeService = new RealtimeService(supabase);
