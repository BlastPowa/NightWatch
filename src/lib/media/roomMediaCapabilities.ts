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
let lastServer: ServerCapabilities | null = null;
let lastSignedIn = false;

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
  lastSignedIn = sessionData.session !== null;
  if (sessionData.session === null) {
    turnDeployed = false;
    lastServer = null;
    return disabledRoomMediaCapabilities();
  }

  const [{ data, error }, turn] = await Promise.all([
    supabase.rpc('get_room_comms_capabilities'),
    probeTurnFunction(),
  ]);
  turnDeployed = turn;
  if (error !== null) {
    lastServer = null;
    return disabledRoomMediaCapabilities();
  }
  const server = parseServerCapabilities(data);
  lastServer = server;
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
  lastServer = null;
  lastSignedIn = false;
}

// ---------------------------------------------------------------------------
// Disabled-control diagnostics (remaining-features handoff, Priority 4).
// The frontend shows WHY a gated surface is off — an actionable reason, not
// a silent absence. Reasons never include secrets or deployment internals
// beyond "not deployed yet".
// ---------------------------------------------------------------------------

export type CapabilityDisabledReason =
  | 'available'
  | 'signed-out'
  | 'not-deployed'
  | 'unsupported-platform'
  | 'relay-not-configured';

export type RoomMediaCapabilityReasons = Record<
  keyof RoomMediaCapabilities,
  CapabilityDisabledReason
>;

/**
 * Explain each flag using the most recent detection pass. Call AFTER
 * getRoomMediaCapabilities (it performs the probe); this function is pure
 * over that cached state and safe on render paths.
 */
export function explainRoomMediaCapabilities(
  platform: PlatformMediaSupport,
): RoomMediaCapabilityReasons {
  const explain = (
    deployed: boolean,
    platformOk: boolean,
    needsTurn: boolean,
  ): CapabilityDisabledReason => {
    if (!lastSignedIn) {
      return 'signed-out';
    }
    if (lastServer === null || !deployed) {
      return 'not-deployed';
    }
    if (!platformOk) {
      return 'unsupported-platform';
    }
    if (needsTurn && !turnDeployed) {
      return 'relay-not-configured';
    }
    return 'available';
  };

  return {
    fileWatch: explain(lastServer?.roomMedia === true, platform.htmlMedia, false),
    driveWorkspace: explain(lastServer?.roomMedia === true, platform.googleDrive, false),
    liveShare: explain(lastServer?.signaling === true, true, true),
    voiceChat: explain(lastServer?.signaling === true, true, true),
    publicUserSearch: explain(lastServer?.peopleDiscovery === true, true, false),
    roomPeopleActions: explain(lastServer?.roomPeople === true, true, false),
  };
}
