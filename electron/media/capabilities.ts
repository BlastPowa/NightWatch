/**
 * Phase 29 capability gate.
 *
 * Everything here is OFF by default and stays off until the matching platform
 * implementation, security tests, packaged tests, and owner review are done —
 * per the Phase 29 handoff, TypeScript compiling is not the bar for enabling
 * Drive.
 *
 * The flags are read from the environment at build time rather than from a
 * user-writable file: a capability a user can switch on locally is a capability
 * an attacker who reaches the user's disk can switch on too.
 */

import {
  SUPPORTED_MEDIA_PROTOCOL_VERSIONS,
  type MediaCapabilities,
  type MediaCapabilityReason,
} from '@shared/media';

/**
 * Owner-controlled build flags. Absent means off.
 *
 * `NIGHTWATCH_ENABLE_LOCAL_FILES` — local file selection and playback.
 * `NIGHTWATCH_ENABLE_DRIVE`       — Google Drive (requires OAuth config).
 * `NIGHTWATCH_ENABLE_LIBRARY`     — cloud Library metadata (requires migration).
 */
function flag(name: string): boolean {
  return process.env[name] === '1';
}

/**
 * Drive additionally needs the full desktop OAuth + Picker configuration:
 * client id (system-browser PKCE), Picker API key, and app id. Any missing
 * piece means 'not-configured', never a partially-working surface.
 */
export function isDriveConfigured(): boolean {
  return (
    hasValue('NIGHTWATCH_GOOGLE_CLIENT_ID') &&
    hasValue('NIGHTWATCH_GOOGLE_PICKER_API_KEY') &&
    hasValue('NIGHTWATCH_GOOGLE_APP_ID')
  );
}

function hasValue(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0;
}

/**
 * YouTube account connection (Settings → Account). Same OAuth client as
 * Drive, its own flag and its own consent: enabling Drive does not silently
 * enable this, or vice versa.
 */
export function isYouTubeAccountEnabled(): boolean {
  return flag('NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT') && hasValue('NIGHTWATCH_GOOGLE_CLIENT_ID');
}

export interface CapabilityGate {
  localFiles: boolean;
  googleDrive: boolean;
  library: boolean;
}

/**
 * Resolve what this build may actually do.
 *
 * Drive is implemented (system-browser PKCE, safeStorage tokens, isolated
 * Picker, range streaming) but still defaults OFF: it needs the owner flag AND
 * the full OAuth/Picker configuration, and per the handoff it is only switched
 * on after OAuth verification and the revocation/range tests pass — never
 * merely because TypeScript builds.
 */
export function resolveCapabilities(): MediaCapabilities {
  const localFiles = flag('NIGHTWATCH_ENABLE_LOCAL_FILES');

  const googleDrive = flag('NIGHTWATCH_ENABLE_DRIVE') && isDriveConfigured();

  const library = flag('NIGHTWATCH_ENABLE_LIBRARY');

  const driveReason: MediaCapabilityReason = googleDrive
    ? 'available'
    : !flag('NIGHTWATCH_ENABLE_DRIVE')
      ? 'disabled-by-owner'
      : 'not-configured';

  // HTML media is the shared substrate: the <video> element, the private
  // scheme, the lease. It is on when anything that needs it is on.
  const htmlMedia = localFiles || googleDrive;

  return {
    youtube: true,
    htmlMedia,
    localFiles,
    googleDrive,
    library,
    // Advertise a protocol version only when there is something to play with
    // it. A build with everything off must not be counted as a ready
    // participant in a custom-media session.
    mediaProtocolVersions: htmlMedia ? SUPPORTED_MEDIA_PROTOCOL_VERSIONS : [],
    reasons: {
      htmlMedia: htmlMedia ? 'available' : 'disabled-by-owner',
      localFiles: localFiles ? 'available' : 'disabled-by-owner',
      googleDrive: driveReason,
      library: library ? 'available' : 'deployment-required',
    },
  };
}

export function currentGate(): CapabilityGate {
  const capabilities = resolveCapabilities();
  return {
    localFiles: capabilities.localFiles,
    googleDrive: capabilities.googleDrive,
    library: capabilities.library,
  };
}

/** Packaged-app ceiling on a selectable file, overridable by the owner. */
export function maxMediaSizeBytes(): number {
  const raw = process.env['NIGHTWATCH_MAX_MEDIA_BYTES'];
  // Digits only, checked before parsing: parseInt('1.5') is 1, so a typo'd
  // override would otherwise silently cap every file at one byte.
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 32 * 1024 * 1024 * 1024;
}
