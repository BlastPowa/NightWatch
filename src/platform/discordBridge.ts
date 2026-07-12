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
 * Identity: the Activity authorizes with the `identify` scope, exchanges
 * the code via the discord-token Edge Function (Client Secret stays
 * server-side), and authenticates the SDK — giving the user's real
 * Discord name/avatar. If any step fails (function not deployed, user
 * declines), the app falls back to the guest name prompt (ADR-005).
 */

interface DiscordIdentity {
  name: string;
  avatarUrl: string | null;
}

async function authenticate(
  sdk: DiscordSDK,
  clientId: string,
  supabaseUrl: string,
  anonKey: string,
): Promise<DiscordIdentity | null> {
  try {
    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });

    const response = await fetch(`${supabaseUrl}/functions/v1/discord-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { access_token?: unknown };
    if (typeof data.access_token !== 'string') {
      return null;
    }

    const auth = await sdk.commands.authenticate({ access_token: data.access_token });
    const user = auth.user;
    const name =
      (typeof user.global_name === 'string' && user.global_name) || user.username || null;
    if (name === null) {
      return null;
    }
    const avatarUrl =
      typeof user.avatar === 'string' && user.avatar.length > 0
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : null;
    return { name: name.slice(0, 24), avatarUrl };
  } catch {
    // Fall back to the guest flow — identity is a nicety, never a gate.
    return null;
  }
}

export async function createDiscordBridge(clientId: string): Promise<PlatformBridge> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY.trim();
  const supabaseHost = new URL(supabaseUrl).host;

  patchUrlMappings([
    { prefix: '/supabase', target: supabaseHost },
    { prefix: '/youtube', target: 'www.youtube.com' },
    { prefix: '/ytimg', target: 'i.ytimg.com' },
    { prefix: '/ytstatic', target: 's.ytimg.com' },
    { prefix: '/discordcdn', target: 'cdn.discordapp.com' },
  ]);

  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const channelId = sdk.channelId;
  const fixedRoomCode = channelId !== null ? deriveRoomCode(channelId) : null;

  // Authenticate once at startup; consumers await the shared promise.
  const identityPromise = authenticate(sdk, clientId, supabaseUrl, anonKey);

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
    getPlatformIdentity: () => identityPromise,
    // The Activity is embedded in Discord's own frame. It has no window of its
    // own, and drawing a title bar inside someone else's chrome is exactly the
    // kind of thing that gets an Activity rejected.
    getWindowState: () => Promise.resolve(null),
    onWindowState: () => () => {},
    // The Activity is already inside Discord, and its iframe is sandboxed away
    // from the Notification API — the room is on screen, so this is a no-op.
    notify: () => {},
  };
}
