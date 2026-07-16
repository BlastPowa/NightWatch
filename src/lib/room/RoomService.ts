import {
  ROOM_EVENTS,
  type EventListener,
  type EventPayload,
  type RealtimeEventName,
} from '@shared/events';
import {
  sanitizeAvatarUrl,
  sanitizeSocialUserId,
  type PresenceMeta,
  type RoomMember,
} from '@shared/room';
import { achievementTracker } from '@/lib/engagement/AchievementTracker';
import type { GuestIdentity } from '@/lib/identity';
import type { ChannelHandle, RealtimeService } from '@/lib/realtime/RealtimeService';
import { ChannelName, type ConnectionStatus } from '@/lib/realtime/types';

export type RoomStatus = 'joining' | 'joined' | 'reconnecting' | 'error' | 'left';

export interface RoomState {
  code: string;
  status: RoomStatus;
  members: RoomMember[];
  hostId: string | null;
}

export type RoomStateListener = (state: RoomState) => void;

/**
 * Derive the member list and host from raw presence state.
 * Host = earliest joinedAt, tiebroken by id — every client computes the
 * same result, so no election protocol is needed (ADR-006 groundwork).
 */
function deriveMembers(presence: Record<string, PresenceMeta[]>): RoomMember[] {
  const metas: PresenceMeta[] = [];
  for (const entries of Object.values(presence)) {
    const meta = entries[0];
    if (meta !== undefined) {
      metas.push(meta);
    }
  }

  metas.sort((a, b) => (a.joinedAt !== b.joinedAt ? a.joinedAt - b.joinedAt : a.memberId.localeCompare(b.memberId)));

  return metas.map((meta, index) => ({
    id: meta.memberId,
    displayName: meta.displayName,
    joinedAt: meta.joinedAt,
    isHost: index === 0,
    streakDays:
      typeof meta.streakDays === 'number' && Number.isFinite(meta.streakDays)
        ? Math.max(0, Math.min(9999, Math.floor(meta.streakDays)))
        : 0,
    // Never trust a peer's avatar value: validate the host/format before it can
    // reach another member's UI. Invalid or absent → null (render the initial).
    avatarUrl: sanitizeAvatarUrl(meta.avatarUrl),
    socialUserId: sanitizeSocialUserId(meta.socialUserId),
  }));
}

/**
 * Manages membership of a single room: joins its channel, tracks this
 * client into Presence, derives the member list and host on every sync,
 * and surfaces reconnection status. One instance per joined room.
 */
export class RoomService {
  private handle: ChannelHandle | null = null;
  private state: RoomState;
  private hasJoinedOnce = false;
  private readonly joinedAt = Date.now();
  private readonly eventListeners = new Map<string, Set<(envelope: unknown) => void>>();

  public constructor(
    private readonly realtime: RealtimeService,
    private readonly identity: GuestIdentity,
    code: string,
    private readonly listener: RoomStateListener,
  ) {
    this.state = { code, status: 'joining', members: [], hostId: null };
  }

  public join(): void {
    this.handle = this.realtime.join(
      ChannelName.room(this.state.code),
      (status) => this.handleConnectionStatus(status),
      {
        presenceKey: this.identity.id,
        broadcastListeners: ROOM_EVENTS.map((event) => ({
          event,
          callback: (envelope: unknown) => {
            // Shape-check every incoming envelope before dispatch (§8):
            // never trust broadcast payloads from other clients.
            if (
              typeof envelope !== 'object' ||
              envelope === null ||
              typeof (envelope as { senderId?: unknown }).senderId !== 'string' ||
              typeof (envelope as { sentAt?: unknown }).sentAt !== 'number' ||
              typeof (envelope as { data?: unknown }).data !== 'object' ||
              (envelope as { data?: unknown }).data === null
            ) {
              return;
            }
            this.eventListeners.get(event)?.forEach((listener) => listener(envelope));
          },
        })),
        onPresenceSync: () => {
          if (this.handle === null) {
            return;
          }
          const members = deriveMembers(this.handle.presenceState<PresenceMeta>());
          this.update({
            members,
            hostId: members[0]?.id ?? null,
          });
        },
      },
    );
  }

  /**
   * Listen for a typed room event. Safe to call at any time (the underlying
   * channel bindings are registered at join). Returns an unsubscribe fn.
   */
  public on<E extends RealtimeEventName>(event: E, listener: EventListener<E>): () => void {
    let listeners = this.eventListeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    const wrapped = listener as (envelope: unknown) => void;
    listeners.add(wrapped);
    return () => {
      listeners.delete(wrapped);
    };
  }

  /** Broadcast a typed room event to other members. */
  public async send<E extends RealtimeEventName>(
    event: E,
    data: EventPayload<E>,
  ): Promise<void> {
    if (this.handle === null) {
      throw new Error('Not connected to a room.');
    }
    await this.handle.send(event, this.identity.id, data);
  }

  /** Envelope helper so consumers can identify their own id. */
  public get selfId(): string {
    return this.identity.id;
  }

  public async leave(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    this.update({ status: 'left', members: [], hostId: null });
    if (handle) {
      await handle.leave();
    }
  }

  private handleConnectionStatus(status: ConnectionStatus): void {
    switch (status) {
      case 'connected': {
        this.hasJoinedOnce = true;
        this.update({ status: 'joined' });
        // Publish only a validated avatar, and omit the field entirely when
        // there is none so the presence payload stays identical to older
        // clients (an explicit `avatarUrl: undefined` would still serialize).
        const avatarUrl = sanitizeAvatarUrl(this.identity.avatarUrl);
        const socialUserId = sanitizeSocialUserId(this.identity.socialUserId);
        const meta: PresenceMeta = {
          memberId: this.identity.id,
          displayName: this.identity.displayName,
          joinedAt: this.joinedAt,
          streakDays: achievementTracker.get().stats.streakDays,
          ...(avatarUrl !== null ? { avatarUrl } : {}),
          ...(socialUserId !== null ? { socialUserId } : {}),
        };
        void this.handle?.track({ ...meta });
        break;
      }
      case 'connecting':
        this.update({ status: this.hasJoinedOnce ? 'reconnecting' : 'joining' });
        break;
      case 'error':
        this.update({ status: this.hasJoinedOnce ? 'reconnecting' : 'error' });
        break;
      case 'disconnected':
        if (this.state.status !== 'left') {
          this.update({ status: this.hasJoinedOnce ? 'reconnecting' : 'error' });
        }
        break;
    }
  }

  private update(partial: Partial<RoomState>): void {
    this.state = { ...this.state, ...partial };
    this.listener(this.state);
  }
}
