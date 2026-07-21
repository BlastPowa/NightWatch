// Supabase Edge Function: turn-credentials (Phase 32, handoff §4)
//
// Mints SHORT-LIVED TURN credentials for authenticated, fresh members of a
// live room. The TURN shared secret exists only here — never in any client.
//
// Provider models:
//   1. Cloudflare Realtime TURN: the Edge Function calls Cloudflare's
//      server-side generate-ice-servers endpoint with a TURN key id/token.
//   2. Self-hosted coturn: the standard static-auth-secret HMAC convention.
//
// Deploy:
//   supabase functions deploy turn-credentials          (Verify JWT: ON)
// Cloudflare secrets:
//   CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN
// coturn fallback secrets:
//   TURN_SHARED_SECRET, TURN_URLS
//
// Request:  POST { roomCode: string }   (Authorization: Bearer <user JWT>)
// Response: { urls, username, credential, expiresAt }
//           or { error: 'unauthorized' | 'forbidden' | 'not-configured'
//                       | 'rate-limited' | 'server-error' }

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const TTL_SECONDS = 600;

const service = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

interface MintedCredentials {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
}

async function mintCloudflareCredentials(
  keyId: string,
  apiToken: string,
): Promise<MintedCredentials | null> {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    },
  );
  if (!response.ok) {
    return null;
  }
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const iceServers = (value as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(iceServers)) {
    return null;
  }
  const turn = iceServers.find((server) => {
    if (typeof server !== 'object' || server === null) return false;
    const urls = (server as { urls?: unknown }).urls;
    return Array.isArray(urls) && urls.some(
      (url) => typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')),
    );
  }) as { urls?: unknown; username?: unknown; credential?: unknown } | undefined;
  if (
    turn === undefined ||
    !Array.isArray(turn.urls) ||
    typeof turn.username !== 'string' ||
    typeof turn.credential !== 'string'
  ) {
    return null;
  }
  const urls = turn.urls.filter(
    (url): url is string =>
      typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')),
  );
  if (urls.length === 0 || urls.length > 8) {
    return null;
  }
  return {
    urls,
    username: turn.username,
    credential: turn.credential,
    expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
}

async function mintCoturnCredentials(
  secret: string,
  urls: string[],
  userId: string,
): Promise<MintedCredentials> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiresAt}:${userId}`;
  return {
    urls,
    username,
    credential: await hmacSha1Base64(secret, username),
    expiresAt,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'server-error' }, 405);
  }

  const cloudflareKeyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID') ?? '';
  const cloudflareApiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN') ?? '';
  const secret = Deno.env.get('TURN_SHARED_SECRET') ?? '';
  const urlsRaw = Deno.env.get('TURN_URLS') ?? '';
  const urls = urlsRaw
    .split(',')
    .map((url) => url.trim())
    .filter(
      (url) =>
        url.startsWith('turn:') || url.startsWith('turns:') || url.startsWith('stun:'),
    );
  const cloudflareConfigured = cloudflareKeyId.length > 0 && cloudflareApiToken.length > 0;
  const coturnConfigured = secret.length > 0 && urls.length > 0;
  if (!cloudflareConfigured && !coturnConfigured) {
    return json({ error: 'not-configured' }, 503);
  }

  // Resolve the caller from their JWT (function deployed with Verify JWT ON;
  // this re-validates and yields the user id).
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (jwt.length === 0) {
    return json({ error: 'unauthorized' }, 401);
  }
  const { data: userData, error: userError } = await service.auth.getUser(jwt);
  if (userError !== null || userData.user === null) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { roomCode?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'server-error' }, 400);
  }

  // Safe diagnostics (remaining-features handoff, Priority 1): authenticated
  // callers may confirm THAT a relay is configured and which provider model,
  // without any secret material, URL list, or credential being revealed.
  if (body.action === 'diagnostics') {
    return json({
      configured: true, // unreachable when unconfigured (503 above)
      provider: cloudflareConfigured ? 'cloudflare' : 'coturn',
      ttlSeconds: TTL_SECONDS,
    });
  }

  const roomCode =
    typeof body.roomCode === 'string' ? body.roomCode.toUpperCase().slice(0, 6) : '';
  if (roomCode.length !== 6) {
    return json({ error: 'forbidden' }, 403);
  }

  // Membership + per-user issuance cap, enforced in Postgres.
  const { data: authorization, error: authzError } = await service.rpc('authorize_turn_access', {
    p_user: userData.user.id,
    p_room_code: roomCode,
  });
  if (authzError !== null) {
    return json({ error: 'server-error' }, 500);
  }
  if (authorization === 'rate-limited') {
    return json({ error: 'rate-limited' }, 429);
  }
  if (authorization !== 'allowed') {
    return json({ error: 'forbidden' }, 403);
  }

  try {
    const credentials = cloudflareConfigured
      ? await mintCloudflareCredentials(cloudflareKeyId, cloudflareApiToken)
      : await mintCoturnCredentials(secret, urls, userData.user.id);
    return credentials === null
      ? json({ error: 'server-error' }, 502)
      : json(credentials);
  } catch {
    return json({ error: 'server-error' }, 502);
  }
});
