import type { PresenceMeta, RoomMember } from '@shared/room';
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
        const meta: PresenceMeta = {
          memberId: this.identity.id,
          displayName: this.identity.displayName,
          joinedAt: this.joinedAt,
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
