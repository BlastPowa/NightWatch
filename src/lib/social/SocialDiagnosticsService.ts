import { supabase } from '@/lib/supabase';

/**
 * Phase 31: one-call social deployment/authentication diagnosis (0024).
 *
 * v0.1.25 users who connected a YouTube account believed they were signed in;
 * every social control then looked uniformly broken because the capability
 * probe could not say WHY. This service returns a closed diagnosis the UI can
 * show verbatim:
 *
 *   * 'account-required' — no NightWatch (Supabase/Discord) session. YouTube
 *     OAuth never implies NightWatch authentication.
 *   * 'deployment-missing' — the diagnostics RPC itself, or one of the social
 *     RPCs, is not deployed (a migration was skipped).
 *   * 'offline' — the request never reached Postgres.
 *   * 'ready' — signed in and fully deployed; a failing button is a bug, not
 *     a state problem.
 */

export type SocialDiagnosis =
  | { status: 'ready' }
  | { status: 'account-required' }
  | { status: 'deployment-missing'; missing: string[] }
  | { status: 'offline' }
  | { status: 'error' };

interface DiagnosticsPayload {
  hasSession: boolean;
  functions: Record<string, boolean>;
}

function parsePayload(data: unknown): DiagnosticsPayload | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const fns = record['functions'];
  if (typeof fns !== 'object' || fns === null) {
    return null;
  }
  const functions: Record<string, boolean> = {};
  for (const [name, deployed] of Object.entries(fns as Record<string, unknown>)) {
    functions[name] = deployed === true;
  }
  return { hasSession: record['hasSession'] === true, functions };
}

export async function diagnoseSocial(): Promise<SocialDiagnosis> {
  // The session check is local-first: without one, the answer is known before
  // any network call, and it is the answer the affected users needed to see.
  const { data: auth } = await supabase.auth.getSession();
  const hasLocalSession = auth.session !== null;

  const { data, error } = await supabase.rpc('social_diagnostics');
  if (error !== null) {
    if (error.code === '42883' || error.code === '42P01') {
      return { status: 'deployment-missing', missing: ['social_diagnostics'] };
    }
    if (error.code === '' || error.code === undefined) {
      return { status: 'offline' };
    }
    return { status: 'error' };
  }

  const payload = parsePayload(data);
  if (payload === null) {
    return { status: 'error' };
  }
  if (!hasLocalSession || !payload.hasSession) {
    return { status: 'account-required' };
  }
  const missing = Object.entries(payload.functions)
    .filter(([, deployed]) => !deployed)
    .map(([name]) => name)
    .sort();
  if (missing.length > 0) {
    return { status: 'deployment-missing', missing };
  }
  return { status: 'ready' };
}
