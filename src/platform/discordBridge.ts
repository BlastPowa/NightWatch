import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';
import { deriveRoomCode } from '@shared/room';
import type { PlatformBridge } from '@/platform/PlatformBridge';

/**
 * Discord Activity implementation (ADR-008 / Phase 13).
 *
 * patchUrlMappings rewrites all network calls to external hosts through
 * Discord's Activity proxy — the mappings here must match the URL
 * Mappings configured in the Discord Developer Portal.
 *
 * Identity note: full Discord-identity auth requires a server-side OAuth
 * token exchange; for this phase, Activity users pick a display name like
 * guests do (ADR-005 guest path), while the room is fixed to the voice
 * channel so everyone lands together.
 */
export async function createDiscordBridge(clientId: string): Promise<PlatformBridge> {
  const supabaseHost = new URL(import.meta.env.VITE_SUPABASE_URL).host;

  patchUrlMappings([
    { prefix: '/supabase', target: supabaseHost },
    { prefix: '/youtube', target: 'www.youtube.com' },
    { prefix: '/ytimg', target: 'i.ytimg.com' },
    { prefix: '/ytstatic', target: 's.ytimg.com' },
  ]);

  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const channelId = sdk.channelId;
  const fixedRoomCode = channelId !== null ? deriveRoomCode(channelId) : null;

  return {
    kind: 'discord',
    getAppInfo: () => Promise.resolve(null),
    // Discord shows Activity participation natively; no RPC needed here.
    updatePresence: () => {},
    log: (level, message) => {
      if (level === 'error') {
        console.error(`[nightwatch] ${message}`);
      }
    },
    getFixedRoomCode: () => Promise.resolve(fixedRoomCode),
  };
}
