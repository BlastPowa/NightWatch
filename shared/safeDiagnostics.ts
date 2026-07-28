/**
 * Phase 34 — safe, structured operation diagnostics.
 *
 * The rule this module enforces mechanically: a diagnostic may record WHAT
 * happened and WHETHER the caller was signed in / online, and nothing else.
 * It must never carry tokens, OAuth codes, room codes, message bodies, Drive
 * ids, file names, local paths, or user search text — those are exactly the
 * values that leak through "helpful" error strings and end up in log files.
 *
 * The redaction below is deliberately paranoid: rather than trusting call
 * sites to pass clean strings, the only free-text field a diagnostic has is
 * `feature`, which is validated against a fixed allowlist.
 */

export type SafeActionOutcome =
  | 'success'
  | 'signed-out'
  | 'deployment-missing'
  | 'forbidden'
  | 'blocked'
  | 'rate-limited'
  | 'offline'
  | 'conflict'
  | 'failed';

export interface SafeActionDiagnostic {
  /** Correlates one user action across its stages. Random, not derived. */
  operationId: string;
  /** Allowlisted feature name — never a user-supplied string. */
  feature: string;
  outcome: SafeActionOutcome;
  authenticated: boolean;
  online: boolean;
  schemaGeneration: number | null;
}

/**
 * Every feature that may appear in a diagnostic. An unknown name is coerced
 * to 'unknown' rather than logged, so a call site cannot smuggle content
 * (a room code, a search term) into the feature field.
 */
export const DIAGNOSTIC_FEATURES = [
  'auth.session-restore',
  'auth.sign-in',
  'auth.sign-out',
  'auth.token-refresh',
  'capabilities.manifest',
  'friends.graph',
  'friends.request',
  'friends.respond',
  'friends.remove',
  'friends.block',
  'people.search',
  'people.room',
  'messaging.list',
  'messaging.create-direct',
  'messaging.create-group',
  'messaging.send',
  'messaging.read',
  'messaging.moderate',
  'presence.heartbeat',
  'presence.preferences',
  'room.media-publish',
  'room.media-read',
  'room.readiness',
  // Phase 35 — opaque invite tokens. The token itself is never logged; only
  // the fact that a mint/redeem/revoke happened and how it ended.
  'room.invite-mint',
  'room.invite-redeem',
  'room.invite-revoke',
  'discord.invite',
  'discord.participants',
  'rtc.signal',
  'rtc.turn',
  'drive.connect',
  'drive.workspace',
  'drive.list',
  'drive.upload',
  'drive.access-probe',
  'release.smoke',
  'unknown',
] as const;

export type DiagnosticFeature = (typeof DIAGNOSTIC_FEATURES)[number];

const FEATURE_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_FEATURES);

export function normalizeFeature(value: string): DiagnosticFeature {
  return FEATURE_SET.has(value) ? (value as DiagnosticFeature) : 'unknown';
}

/** Opaque, unlinkable correlation id. */
export function newOperationId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface DiagnosticContext {
  authenticated: boolean;
  online: boolean;
  schemaGeneration: number | null;
}

/**
 * Build a diagnostic. `feature` is normalized; nothing else is free text, so
 * there is no field an error message or user input can flow into.
 */
export function buildDiagnostic(
  feature: string,
  outcome: SafeActionOutcome,
  context: DiagnosticContext,
  operationId: string = newOperationId(),
): SafeActionDiagnostic {
  return {
    operationId,
    feature: normalizeFeature(feature),
    outcome,
    authenticated: context.authenticated,
    online: context.online,
    schemaGeneration: context.schemaGeneration,
  };
}

/**
 * Render a diagnostic as one log line. Fixed shape, fixed vocabulary — safe
 * to write to the local log file and safe to show a user.
 */
export function formatDiagnostic(diagnostic: SafeActionDiagnostic): string {
  return [
    `op=${diagnostic.operationId}`,
    `feature=${diagnostic.feature}`,
    `outcome=${diagnostic.outcome}`,
    `auth=${String(diagnostic.authenticated)}`,
    `online=${String(diagnostic.online)}`,
    `schema=${diagnostic.schemaGeneration === null ? 'unknown' : String(diagnostic.schemaGeneration)}`,
  ].join(' ');
}

/**
 * Map a Supabase/PostgREST error onto a diagnostic outcome.
 *
 * Codes and shapes only — the error MESSAGE is never copied into the result,
 * because provider messages routinely echo the offending input back.
 */
export function outcomeFromError(error: {
  code?: string | null;
  message?: string | null;
  status?: number;
}): SafeActionOutcome {
  if (error.code === '42883' || error.code === '42P01') {
    return 'deployment-missing';
  }
  const message = (error.message ?? '').toLowerCase();
  // Only fixed sentinel words raised by our own functions are inspected.
  if (message.includes('blocked')) {
    return 'blocked';
  }
  if (message.includes('rate-limited') || message.includes('rate limit') || error.status === 429) {
    return 'rate-limited';
  }
  if (message.includes('unauthenticated') || error.status === 401) {
    return 'signed-out';
  }
  if (message.includes('forbidden') || error.status === 403) {
    return 'forbidden';
  }
  if (message.includes('revision') || message.includes('conflict') || error.status === 409) {
    return 'conflict';
  }
  if (message.includes('failed to fetch') || message.includes('networkerror')) {
    return 'offline';
  }
  return 'failed';
}

/**
 * Defence in depth: assert a diagnostic carries no unexpected keys before it
 * is logged or transported. Returns the sanitized object.
 */
export function sanitizeDiagnostic(diagnostic: SafeActionDiagnostic): SafeActionDiagnostic {
  return {
    operationId: diagnostic.operationId.slice(0, 32),
    feature: normalizeFeature(diagnostic.feature),
    outcome: diagnostic.outcome,
    authenticated: diagnostic.authenticated === true,
    online: diagnostic.online === true,
    schemaGeneration:
      typeof diagnostic.schemaGeneration === 'number' &&
      Number.isFinite(diagnostic.schemaGeneration)
        ? diagnostic.schemaGeneration
        : null,
  };
}
