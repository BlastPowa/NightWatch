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

/** Central registry mapping event names to their payload types. */
export interface RealtimeEventMap {
  /** Host loaded a new video. */
  'playback:load': { videoId: string };
  /** Host started playback. hostClockMs allows latency compensation. */
  'playback:play': { positionSeconds: number; hostClockMs: number };
  /** Host paused playback. Position doubles as seek-while-paused sync. */
  'playback:pause': { positionSeconds: number };
  /** A member (late joiner / reconnector) asks the host for current state. */
  'sync:request': Record<string, never>;
  /** Host's authoritative snapshot of playback state. */
  'sync:state': {
    videoId: string | null;
    positionSeconds: number;
    isPlaying: boolean;
    hostClockMs: number;
  };
}

/**
 * All events carried on a room channel. Broadcast bindings must be
 * registered before channel subscribe (Supabase requirement), so the room
 * layer registers every known event up front and dispatches internally.
 */
export const ROOM_EVENTS: readonly (keyof RealtimeEventMap & string)[] = [
  'playback:load',
  'playback:play',
  'playback:pause',
  'sync:request',
  'sync:state',
];

export type RealtimeEventName = keyof RealtimeEventMap & string;

export type EventPayload<E extends RealtimeEventName> = RealtimeEventMap[E];

export type EventListener<E extends RealtimeEventName> = (
  envelope: EventEnvelope<EventPayload<E>>,
) => void;
