/**
 * Typed realtime event architecture.
 *
 * Every broadcast sent over a Supabase Realtime channel is wrapped in an
 * EventEnvelope so all messages carry sender identity and a timestamp.
 * Concrete event maps (room, chat, playback) are added in later phases by
 * extending RealtimeEventMap via interface merging — the transport and
 * typing machinery below never needs to change.
 */

import {
  MEDIA_V1_EVENTS,
  type Phase29RealtimeEvents,
} from './mediaPlayback';

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
export interface RealtimeEventMap extends Phase29RealtimeEvents {
  /** Host loaded a new video. */
  'playback:load': { videoId: string };
  /** Host started playback. hostClockMs allows latency compensation. */
  'playback:play': { positionSeconds: number; hostClockMs: number };
  /** Host paused playback. Position doubles as seek-while-paused sync. */
  'playback:pause': { positionSeconds: number };
  /** A chat message. senderName travels in the payload so messages from
   *  members who have since left still render correctly. */
  'chat:message': { text: string; senderName: string };
  /** An emoji reaction stamped at a video timestamp. Emoji is validated
   *  against the palette on receipt (shared/reactions.ts). */
  'reaction:stamp': { emoji: string; videoId: string; positionSeconds: number };
  /** Ask the host to add a video to the shared queue. */
  'queue:add': { videoId: string; title: string; addedByName: string };
  /** Toggle the sender's upvote on a queue entry. */
  'queue:vote': { entryId: string };
  /** Ask the host to remove a queue entry (adder or host only). */
  'queue:remove': { entryId: string };
  /** Host's authoritative queue snapshot (broadcast on every change). */
  'queue:state': { entries: unknown[] };
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
  'chat:message',
  'reaction:stamp',
  'queue:add',
  'queue:vote',
  'queue:remove',
  'queue:state',
  'sync:request',
  'sync:state',
  ...MEDIA_V1_EVENTS,
];

export type RealtimeEventName = keyof RealtimeEventMap & string;

export type EventPayload<E extends RealtimeEventName> = RealtimeEventMap[E];

export type EventListener<E extends RealtimeEventName> = (
  envelope: EventEnvelope<EventPayload<E>>,
) => void;
