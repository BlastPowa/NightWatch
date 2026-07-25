import { getRuntimeCapabilityManifest } from '@/lib/runtime/RuntimeCapabilityService';

export interface SocialCapabilities {
  friends: boolean;
  messaging: boolean;
  momentNotes: boolean;
  creatorClubs: boolean;
  notifications: boolean;
  clubDiscovery: boolean;
  highlights: boolean;
  friendMediaPresence: boolean;
}

const NONE: SocialCapabilities = {
  friends: false,
  messaging: false,
  momentNotes: false,
  creatorClubs: false,
  notifications: false,
  clubDiscovery: false,
  highlights: false,
  friendMediaPresence: false,
};

let cached: SocialCapabilities | null = null;
let inFlight: Promise<SocialCapabilities> | null = null;

function hasEvery(functions: Readonly<Record<string, boolean>>, names: readonly string[]): boolean {
  return names.every((name) => functions[name] === true);
}

/** Detect from one read-only manifest. No feature RPC is executed as a probe. */
async function detect(): Promise<SocialCapabilities> {
  const result = await getRuntimeCapabilityManifest();
  if (result.status !== 'ok' || !result.data.authenticated) return NONE;
  const functions = result.data.functions;
  return {
    friends: hasEvery(functions, ['get_social_graph', 'send_friend_request']),
    messaging: hasEvery(functions, ['list_conversations', 'get_messages', 'send_message']),
    momentNotes: functions['list_moment_notes'] === true,
    creatorClubs: functions['list_my_clubs'] === true,
    notifications: functions['count_unread_notifications'] === true,
    clubDiscovery: functions['search_clubs'] === true,
    highlights: functions['get_session_highlights'] === true,
    friendMediaPresence: functions['get_friend_presence_v2'] === true,
  };
}

/** Cached until auth/network/application lifecycle asks for a fresh manifest. */
export async function getSocialCapabilities(): Promise<SocialCapabilities> {
  if (cached !== null) return cached;
  inFlight ??= detect()
    .then((capabilities) => {
      cached = capabilities;
      return capabilities;
    })
    .catch(() => NONE)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function resetSocialCapabilities(): void {
  cached = null;
  inFlight = null;
}

export function getCachedCapabilities(): SocialCapabilities {
  return cached ?? NONE;
}
