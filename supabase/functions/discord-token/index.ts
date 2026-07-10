// Supabase Edge Function: discord-token (Phase 13 completion)
//
// Exchanges a Discord Activity authorization code for an access token.
// The Discord Client Secret lives ONLY as a Supabase secret. Deploy:
//   supabase functions deploy discord-token --no-verify-jwt
//   supabase secrets set DISCORD_CLIENT_ID=<client id>
//   supabase secrets set DISCORD_CLIENT_SECRET=<client secret>
//
// Request:  POST { code: string }
// Response: { access_token: string }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// Coarse per-instance rate limit — token exchanges are rare (one per
// Activity launch), so a small cap per IP-ish key is plenty.
const usage = new Map<string, { day: string; count: number }>();

function isRateLimited(key: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = usage.get(key);
  if (entry === undefined || entry.day !== today) {
    usage.set(key, { day: today, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 100;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const clientId = Deno.env.get('DISCORD_CLIENT_ID');
  const clientSecret = Deno.env.get('DISCORD_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'not-configured' }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }

  const rateKey = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(rateKey)) {
    return new Response(JSON.stringify({ error: 'rate-limited' }), {
      status: 429,
      headers: JSON_HEADERS,
    });
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad-request' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  const code = typeof body.code === 'string' ? body.code.slice(0, 256) : '';
  if (code.length === 0) {
    return new Response(JSON.stringify({ error: 'bad-request' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!tokenResponse.ok) {
    return new Response(JSON.stringify({ error: 'exchange-failed' }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof tokenData.access_token !== 'string') {
    return new Response(JSON.stringify({ error: 'exchange-failed' }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }

  // Return only the access token — nothing else from Discord's response.
  return new Response(JSON.stringify({ access_token: tokenData.access_token }), {
    headers: JSON_HEADERS,
  });
});
