import {
  disabledRoomMediaCapabilities,
  type RoomMediaCapabilities,
} from '@shared/roomComms';
import { supabase } from '@/lib/supabase';
import { isFeatureReady } from '@shared/runtimeCapabilities';
import { runtimeCapabilities } from '@/lib/platform/RuntimeCapabilityService';

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
  // Use the Phase 34 manifest rather than racing auth restoration or probing
  // feature RPCs. This is the same production-safe path used by Friends and
  // Messages, so Movie Watch cannot be permanently disabled on cold launch.
  await runtimeCapabilities.whenSessionSettled();
  const manifest = await runtimeCapabilities.refresh('room-media.capabilities');
  lastSignedIn = manifest.authenticated;
  if (!manifest.authenticated) {
    turnDeployed = false;
    lastServer = null;
    return disabledRoomMediaCapabilities();
  }

  const server: ServerCapabilities = {
    peopleDiscovery: isFeatureReady(manifest, 'peopleSearch'),
    roomPeople: isFeatureReady(manifest, 'roomPeople'),
    roomMedia: isFeatureReady(manifest, 'roomMedia'),
    signaling: isFeatureReady(manifest, 'signaling'),
  };
  // TURN is only meaningful after the signed-in manifest proves signaling is
  // deployed. File Watch and Drive therefore remain non-destructive here.
  const turn = server.signaling ? await probeTurnFunction() : false;
  turnDeployed = turn;
  lastServer = server;

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

// Auth refreshes, reconnects, and app resumes are all represented by a new
// manifest. Drop memoized platform answers so a stale signed-out result never
// keeps Drive/Movie Watch disabled for the rest of a packaged session.
runtimeCapabilities.subscribe(() => {
  cache.clear();
  pending.clear();
});

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
