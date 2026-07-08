/**
 * Typed realtime event architecture.
 *
 * Every broadcast sent over a Supabase Realtime channel is wrapped in an
 * EventEnvelope so all messages carry sender identity and a timestamp.
 * Concrete event maps (room, chat, playback) are added in later phases by
 * extending RealtimeEventMap via interface merging — the transport and
 * typing machinery below never needs to change.
 */

/** Wire format for every broadcast payload NightWatch sends. */
export interface EventEnvelope<TData> {
  /** Client-generated id of the sender (user or guest session). */
  senderId: string;
  /** Unix epoch milliseconds at send time (sender's clock). */
  sentAt: number;
  /** Event-specific payload. */
  data: TData;
}

/**
 * Central registry mapping event names to their payload types.
 * Later phases extend this via declaration merging, e.g.:
 *
 *   declare module '@shared/events' {
 *     interface RealtimeEventMap {
 *       'playback:play': { positionSeconds: number };
 *     }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RealtimeEventMap {}

export type RealtimeEventName = keyof RealtimeEventMap & string;

export type EventPayload<E extends RealtimeEventName> = RealtimeEventMap[E];

export type EventListener<E extends RealtimeEventName> = (
  envelope: EventEnvelope<EventPayload<E>>,
) => void;
