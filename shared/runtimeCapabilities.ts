/**
 * Phase 34 — the runtime capability manifest contract.
 *
 * One authenticated, non-destructive round trip tells the renderer exactly
 * what the server supports and whether THIS caller is signed in. It replaces
 * probing feature RPCs, which consumed quota, wrote presence rows, and could
 * not tell "signed out" from "migration missing" — the precise ambiguity
 * behind the packaged social failures.
 *
 * Pure module: no Supabase, no DOM, no Electron. Imported by the renderer,
 * the platform layer, and the tests.
 */

export interface RuntimeCapabilityManifestV2 {
  /** Monotonic; increases when a client-visible contract changes. */
  schemaGeneration: number;
  /** Derived server-side from the caller's JWT — never from local state. */
  authenticated: boolean;
  /** Exact-signature deployment flags, keyed by function name. */
  functions: Record<string, boolean>;
  /** Tables present in the Realtime publication AND safe for clients. */
  realtimeTables: string[];
}

/** A manifest that grants nothing — the safe default on any failure. */
export function emptyManifest(): RuntimeCapabilityManifestV2 {
  return {
    schemaGeneration: 0,
    authenticated: false,
    functions: {},
    realtimeTables: [],
  };
}

/**
 * Validate an untrusted manifest payload.
 *
 * Anything malformed becomes null rather than a partially-trusted object: a
 * half-read manifest would enable surfaces whose backing RPC may not exist.
 */
export function parseRuntimeManifest(value: unknown): RuntimeCapabilityManifestV2 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;

  const schemaGeneration = record['schemaGeneration'];
  const authenticated = record['authenticated'];
  const functions = record['functions'];
  const realtimeTables = record['realtimeTables'];

  if (
    typeof schemaGeneration !== 'number' ||
    !Number.isFinite(schemaGeneration) ||
    typeof authenticated !== 'boolean' ||
    typeof functions !== 'object' ||
    functions === null ||
    Array.isArray(functions) ||
    !Array.isArray(realtimeTables)
  ) {
    return null;
  }

  const parsedFunctions: Record<string, boolean> = {};
  for (const [name, deployed] of Object.entries(functions as Record<string, unknown>)) {
    if (typeof deployed === 'boolean') {
      parsedFunctions[name] = deployed;
    }
  }

  return {
    schemaGeneration,
    authenticated,
    functions: parsedFunctions,
    realtimeTables: realtimeTables.filter(
      (table): table is string => typeof table === 'string',
    ),
  };
}

/** Is every named function deployed? Missing keys count as NOT deployed. */
export function hasFunctions(
  manifest: RuntimeCapabilityManifestV2,
  names: readonly string[],
): boolean {
  return names.every((name) => manifest.functions[name] === true);
}

/** Names from `required` that the manifest does not report as deployed. */
export function missingFunctions(
  manifest: RuntimeCapabilityManifestV2,
  required: readonly string[],
): string[] {
  return required.filter((name) => manifest.functions[name] !== true);
}

/**
 * Function groups behind each client feature. Declared here so the renderer,
 * diagnostics, and tests all agree on what a feature actually needs — the
 * usual failure is a UI enabling on a partial deployment.
 */
export const FEATURE_FUNCTION_REQUIREMENTS = {
  friends: [
    'get_social_graph',
    'send_friend_request',
    'accept_friend_request',
    'decline_friend_request',
    'remove_friend',
    'block_user',
    'unblock_user',
  ],
  peopleSearch: ['search_people', 'set_discoverable'],
  roomPeople: ['get_room_people', 'heartbeat_live_room_social'],
  messaging: [
    'list_conversations',
    'create_direct_conversation',
    'get_messages',
    'send_message',
    'mark_conversation_read',
  ],
  groupChat: [
    'create_group_conversation',
    'add_group_member',
    'remove_group_member',
    'leave_conversation',
    'get_conversation_members',
  ],
  presence: [
    'heartbeat_presence',
    'set_presence_preferences',
    'get_friend_presence_v2',
  ],
  roomMedia: [
    'publish_room_media_descriptor',
    'get_room_media_descriptor',
    'report_media_readiness',
    'get_media_readiness_roster',
  ],
  signaling: ['send_rtc_signal', 'fetch_rtc_signals'],
} as const satisfies Record<string, readonly string[]>;

export type RuntimeFeature = keyof typeof FEATURE_FUNCTION_REQUIREMENTS;

/** Is a feature fully deployed AND is the caller signed in? */
export function isFeatureReady(
  manifest: RuntimeCapabilityManifestV2,
  feature: RuntimeFeature,
): boolean {
  return (
    manifest.authenticated &&
    hasFunctions(manifest, FEATURE_FUNCTION_REQUIREMENTS[feature])
  );
}
