// Supabase Edge Function: log-session (Phase 17, ADR-014)
//
// Writes opt-in, anonymized session analytics. The service role key stays
// server-side; writes are refused unless the room has insights_enabled.
// Deploy:
//   supabase functions deploy log-session --no-verify-jwt
// (No extra secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided
//  to Edge Functions automatically.)
//
// Requests (POST):
//   { action: 'start', roomCode }              -> { sessionId }
//   { action: 'log',   sessionId, events: [{ kind, value }] }   (≤50)
//   { action: 'end',   sessionId }

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const EVENT_KINDS = new Set(['members', 'play', 'pause', 'seek', 'reaction']);
const MAX_EVENTS_PER_CALL = 50;
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const usage = new Map<string, { day: string; count: number }>();

function isRateLimited(key: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = usage.get(key);
  if (entry === undefined || entry.day !== today) {
    usage.set(key, { day: today, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 2000;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, 405);
  }
  if (isRateLimited(req.headers.get('x-forwarded-for') ?? 'unknown')) {
    return json({ error: 'rate-limited' }, 429);
  }

  let body: {
    action?: unknown;
    roomCode?: unknown;
    sessionId?: unknown;
    events?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }

  if (body.action === 'start') {
    const roomCode =
      typeof body.roomCode === 'string' ? body.roomCode.toUpperCase().slice(0, 6) : '';
    const { data: room } = await supabase
      .from('rooms')
      .select('code, insights_enabled')
      .eq('code', roomCode)
      .maybeSingle();
    if (room === null || room.insights_enabled !== true) {
      return json({ error: 'not-enabled' }, 403);
    }
    const { data: session, error } = await supabase
      .from('room_sessions')
      .insert({ room_code: roomCode })
      .select('id')
      .single();
    if (error !== null) {
      return json({ error: 'db-error' }, 500);
    }
    return json({ sessionId: session.id });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 40) : '';
  if (sessionId.length === 0) {
    return json({ error: 'bad-request' }, 400);
  }
  const { data: session } = await supabase
    .from('room_sessions')
    .select('id, started_at, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (
    session === null ||
    session.ended_at !== null ||
    Date.now() - new Date(session.started_at as string).getTime() > MAX_SESSION_AGE_MS
  ) {
    return json({ error: 'invalid-session' }, 403);
  }

  if (body.action === 'log') {
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_CALL) : [];
    const rows = events
      .filter(
        (e): e is { kind: string; value: number } =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { kind?: unknown }).kind === 'string' &&
          EVENT_KINDS.has((e as { kind: string }).kind) &&
          typeof (e as { value?: unknown }).value === 'number' &&
          Number.isFinite((e as { value: number }).value),
      )
      .map((e) => ({
        session_id: sessionId,
        kind: e.kind,
        value: Math.max(0, Math.min(1_000_000, e.value)),
      }));
    if (rows.length > 0) {
      await supabase.from('session_events').insert(rows);
    }
    return json({ ok: true });
  }

  if (body.action === 'end') {
    await supabase
      .from('room_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId);
    return json({ ok: true });
  }

  return json({ error: 'bad-request' }, 400);
});
