/**
 * Phase 34 — release-candidate smoke contract.
 *
 * Purpose: let a PACKAGED build report, deterministically and without
 * publishing anything, whether it is actually wired up — configuration
 * present, session restored, server contracts deployed. The Release workflow
 * currently ships without either the full suite or a packaged gate; this is
 * the machine-readable half of closing that hole.
 *
 * Redaction is structural: the report has no free-text field. Every entry is
 * a fixed check id plus a status, so a secret, room code, or path has nowhere
 * to appear even if a caller tried.
 */

export type SmokeStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/** Fixed check vocabulary — extend deliberately, never dynamically. */
export const SMOKE_CHECKS = [
  'config.supabase-url',
  'config.supabase-anon-key',
  'config.discord-client-id',
  'config.google-client-id',
  'platform.secure-context',
  'platform.media-bridge',
  'auth.session-restored',
  'capabilities.manifest-reachable',
  'capabilities.schema-generation',
  'capabilities.social-contracts',
  'capabilities.room-media-contracts',
  'capabilities.signaling-contracts',
  'relay.turn-configured',
] as const;

export type SmokeCheckId = (typeof SMOKE_CHECKS)[number];

export interface SmokeCheckResult {
  id: SmokeCheckId;
  status: SmokeStatus;
}

export interface ReleaseSmokeReport {
  /** Bumped if the report shape changes. */
  reportVersion: 1;
  /** App version string from package metadata (already public). */
  appVersion: string;
  /** True only when the build is packaged (not the dev server). */
  packaged: boolean;
  checks: SmokeCheckResult[];
  /** Overall verdict, derived — see summarizeSmoke. */
  verdict: 'pass' | 'warn' | 'fail';
}

/**
 * Derive the verdict. Any `fail` fails the run; otherwise any `warn` warns.
 * `skipped` never changes the verdict — a check that cannot run (no relay
 * configured yet, for example) is not evidence of breakage.
 */
export function summarizeSmoke(checks: readonly SmokeCheckResult[]): 'pass' | 'warn' | 'fail' {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }
  return checks.some((check) => check.status === 'warn') ? 'warn' : 'pass';
}

/** Process exit code for a packaged smoke invocation. */
export function smokeExitCode(report: ReleaseSmokeReport): number {
  switch (report.verdict) {
    case 'pass':
      return 0;
    case 'warn':
      // Warnings are non-blocking by design: a release candidate without a
      // TURN relay is still a valid candidate for everything else.
      return 0;
    case 'fail':
      return 1;
  }
}

/** One line per check; fixed vocabulary, safe for CI logs. */
export function formatSmokeReport(report: ReleaseSmokeReport): string {
  const lines = [
    `nightwatch-smoke version=${report.appVersion} packaged=${String(report.packaged)}`,
    ...report.checks.map((check) => `  ${check.id}=${check.status}`),
    `verdict=${report.verdict}`,
  ];
  return lines.join('\n');
}

/**
 * Build a report from raw observations. Unknown check ids are dropped rather
 * than passed through, which keeps the vocabulary closed.
 */
export function buildSmokeReport(
  appVersion: string,
  packaged: boolean,
  observed: ReadonlyArray<{ id: string; status: SmokeStatus }>,
): ReleaseSmokeReport {
  const allowed: ReadonlySet<string> = new Set(SMOKE_CHECKS);
  const checks = observed
    .filter((check): check is SmokeCheckResult => allowed.has(check.id))
    .map((check) => ({ id: check.id, status: check.status }));
  return {
    reportVersion: 1,
    // The version string is public, but bound it anyway.
    appVersion: appVersion.slice(0, 32),
    packaged,
    checks,
    verdict: summarizeSmoke(checks),
  };
}
