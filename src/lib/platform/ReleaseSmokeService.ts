import {
  FEATURE_FUNCTION_REQUIREMENTS,
  hasFunctions,
  type RuntimeCapabilityManifestV2,
} from '@shared/runtimeCapabilities';
import {
  buildSmokeReport,
  type ReleaseSmokeReport,
  type SmokeStatus,
} from '@shared/releaseSmoke';
import { getTurnDiagnostics } from '@/lib/rtc/TurnService';
import { runtimeCapabilities } from '@/lib/platform/RuntimeCapabilityService';
import { supabase } from '@/lib/supabase';

/**
 * Phase 34 — packaged release-candidate smoke validation.
 *
 * Answers one question deterministically: "is this candidate wired up?"
 * Configuration present, session restored on relaunch, server contracts
 * deployed, relay configured. It publishes nothing, mutates nothing, and
 * emits only fixed check ids — see shared/releaseSmoke.ts for why the report
 * has no free-text field.
 */

export interface SmokeEnvironment {
  appVersion: string;
  packaged: boolean;
  /** Present only in Electron; the Activity/web build passes null. */
  mediaBridgePresent: boolean;
  secureContext: boolean;
}

function present(value: string | undefined): SmokeStatus {
  return typeof value === 'string' && value.trim().length > 0 ? 'pass' : 'fail';
}

function contractStatus(
  manifest: RuntimeCapabilityManifestV2,
  names: readonly string[],
): SmokeStatus {
  return hasFunctions(manifest, names) ? 'pass' : 'fail';
}

/**
 * Run the smoke checks. Safe to call from a packaged build's diagnostic
 * entry point or from a developer console; it never writes.
 */
export async function runReleaseSmoke(
  environment: SmokeEnvironment,
): Promise<ReleaseSmokeReport> {
  const checks: Array<{ id: string; status: SmokeStatus }> = [
    { id: 'config.supabase-url', status: present(import.meta.env.VITE_SUPABASE_URL) },
    { id: 'config.supabase-anon-key', status: present(import.meta.env.VITE_SUPABASE_ANON_KEY) },
    {
      id: 'config.discord-client-id',
      // Discord is optional for core watch-party use, so absence warns.
      status:
        present(import.meta.env.VITE_DISCORD_CLIENT_ID) === 'pass' ? 'pass' : 'warn',
    },
    {
      id: 'platform.secure-context',
      status: environment.secureContext ? 'pass' : 'fail',
    },
    {
      id: 'platform.media-bridge',
      // Only desktop is expected to have one; elsewhere the check is skipped.
      status: environment.packaged
        ? environment.mediaBridgePresent
          ? 'pass'
          : 'fail'
        : 'skipped',
    },
  ];

  // Session restoration must be evaluated AFTER Supabase settles, which is the
  // exact ordering bug this phase fixes.
  await runtimeCapabilities.whenSessionSettled();
  const { data: sessionData } = await supabase.auth.getSession();
  const signedIn = sessionData.session !== null;
  checks.push({
    id: 'auth.session-restored',
    // Signed-out is a legitimate candidate state; it warns rather than fails
    // so an unattended smoke run is not red merely for lacking credentials.
    status: signedIn ? 'pass' : 'warn',
  });

  const manifest = await runtimeCapabilities.refresh('release.smoke', true);
  const manifestReachable = manifest.schemaGeneration > 0;
  checks.push({
    id: 'capabilities.manifest-reachable',
    status: manifestReachable ? 'pass' : 'fail',
  });
  checks.push({
    id: 'capabilities.schema-generation',
    status: manifest.schemaGeneration >= 34 ? 'pass' : 'warn',
  });

  if (manifestReachable) {
    checks.push({
      id: 'capabilities.social-contracts',
      status: contractStatus(manifest, [
        ...FEATURE_FUNCTION_REQUIREMENTS.friends,
        ...FEATURE_FUNCTION_REQUIREMENTS.messaging,
        ...FEATURE_FUNCTION_REQUIREMENTS.presence,
      ]),
    });
    checks.push({
      id: 'capabilities.room-media-contracts',
      status: contractStatus(manifest, FEATURE_FUNCTION_REQUIREMENTS.roomMedia),
    });
    checks.push({
      id: 'capabilities.signaling-contracts',
      status: contractStatus(manifest, FEATURE_FUNCTION_REQUIREMENTS.signaling),
    });
  } else {
    for (const id of [
      'capabilities.social-contracts',
      'capabilities.room-media-contracts',
      'capabilities.signaling-contracts',
    ]) {
      checks.push({ id, status: 'skipped' });
    }
  }

  const turn = await getTurnDiagnostics();
  checks.push({
    id: 'relay.turn-configured',
    // Voice/share stay capability-gated until packaged acceptance, so an
    // unconfigured relay is a warning about scope, not a broken candidate.
    status: turn.configured ? 'pass' : 'warn',
  });

  return buildSmokeReport(environment.appVersion, environment.packaged, checks);
}
