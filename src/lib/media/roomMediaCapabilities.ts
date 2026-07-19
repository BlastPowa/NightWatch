import {
  disabledRoomMediaCapabilities,
  type RoomMediaCapabilities,
} from '@shared/roomComms';
import { supabase } from '@/lib/supabase';

/**
 * Phase 32 capability detection. A single side-effect-free database RPC
 * reports which server contracts are deployed; platform and authentication
 * requirements are then applied locally. No search quota, presence row, TURN
 * credential, or room state is consumed merely by opening the application.
 */

export interface PlatformMediaSupport {
  htmlMedia: boolean;
  googleDrive: boolean;
}

interface ServerCapabilities {
  schemaVersion: 1;
  peopleDiscovery: boolean;
  roomPeople: boolean;
  roomMedia: boolean;
  signaling: boolean;
}

const cache = new Map<string, RoomMediaCapabilities>();
const pending = new Map<string, Promise<RoomMediaCapabilities>>();
let turnDeployed = false;

function parseServerCapabilities(value: unknown): ServerCapabilities | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    row['schemaVersion'] !== 1 ||
    typeof row['peopleDiscovery'] !== 'boolean' ||
    typeof row['roomPeople'] !== 'boolean' ||
    typeof row['roomMedia'] !== 'boolean' ||
    typeof row['signaling'] !== 'boolean'
  ) {
    return null;
  }
  return row as unknown as ServerCapabilities;
}

/** Auth/room errors prove a configured function; 404/5xx fail closed. */
async function probeTurnFunction(): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('turn-credentials', {
      body: { roomCode: 'PROBE0' },
    });
    if (error === null) {
      return true;
    }
    const status = (error as { context?: { status?: number } }).context?.status;
    return status === 401 || status === 403 || status === 429;
  } catch {
    return false;
  }
}

async function detect(platform: PlatformMediaSupport): Promise<RoomMediaCapabilities> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session === null) {
    turnDeployed = false;
    return disabledRoomMediaCapabilities();
  }

  const [{ data, error }, turn] = await Promise.all([
    supabase.rpc('get_room_comms_capabilities'),
    probeTurnFunction(),
  ]);
  turnDeployed = turn;
  if (error !== null) {
    return disabledRoomMediaCapabilities();
  }
  const server = parseServerCapabilities(data);
  if (server === null) {
    return disabledRoomMediaCapabilities();
  }

  return {
    fileWatch: server.roomMedia && platform.htmlMedia,
    driveWorkspace: server.roomMedia && platform.googleDrive,
    // Reliable public use requires both the room-scoped signaling contract
    // and a deployed relay credential service.
    liveShare: server.signaling && turn,
    voiceChat: server.signaling && turn,
    publicUserSearch: server.peopleDiscovery,
    roomPeopleActions: server.roomPeople,
  };
}

export async function getRoomMediaCapabilities(
  platform: PlatformMediaSupport,
): Promise<RoomMediaCapabilities> {
  const key = `${platform.htmlMedia}:${platform.googleDrive}`;
  const existing = cache.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const active = pending.get(key);
  if (active !== undefined) {
    return active;
  }
  const request = detect(platform)
    .then((capabilities) => {
      cache.set(key, capabilities);
      return capabilities;
    })
    .catch(() => disabledRoomMediaCapabilities())
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function isTurnDeployed(): boolean {
  return turnDeployed;
}

export function resetRoomMediaCapabilities(): void {
  cache.clear();
  pending.clear();
  turnDeployed = false;
}
