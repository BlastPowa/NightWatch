import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type {
  EventEnvelope,
  EventListener,
  EventPayload,
  RealtimeEventName,
} from '@shared/events';
import { supabase } from '@/lib/supabase';
import type { ConnectionStatus, ConnectionStatusListener } from '@/lib/realtime/types';

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
  /** Listen for a typed event broadcast by other channel members. */
  on<E extends RealtimeEventName>(event: E, listener: EventListener<E>): void;
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
 * join/leave/broadcast traffic in the app goes through this service so the
 * Supabase SDK never leaks into feature code.
 */
export class RealtimeService {
  private readonly channels = new Map<string, RealtimeChannel>();

  public constructor(private readonly client: SupabaseClient) {}

  /**
   * Join (or re-join) a channel by topic. Joining a topic that is already
   * joined returns a handle to the existing channel.
   */
  public join(topic: string, onStatusChange?: ConnectionStatusListener): ChannelHandle {
    const existing = this.channels.get(topic);
    const channel =
      existing ??
      this.client.channel(topic, {
        config: { broadcast: { self: false, ack: true } },
      });

    if (!existing) {
      this.channels.set(topic, channel);
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
      on: <E extends RealtimeEventName>(event: E, listener: EventListener<E>): void => {
        channel.on('broadcast', { event }, (message) => {
          listener(message['payload'] as EventEnvelope<EventPayload<E>>);
        });
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
