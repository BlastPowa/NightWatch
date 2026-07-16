/**
 * Guest identity (ADR-005 fallback path). A stable id plus a display name,
 * persisted locally so the same person keeps their identity across launches.
 * Discord OAuth (the primary path) is added in a later phase and will layer
 * on top of this interface.
 */

import { sanitizeAvatarUrl, sanitizeSocialUserId } from '@shared/room';

export interface GuestIdentity {
  id: string;
  displayName: string;
  /**
   * Canonical Discord CDN avatar URL (Phase 24), when the person signed in with
   * Discord or launched inside a Discord Activity. Optional and non-persisted:
   * it is re-derived from the auth session / platform identity each launch, so
   * a rotated or revoked avatar never lingers in localStorage.
   */
  avatarUrl?: string | null;
  /**
   * Supabase auth identity for social discovery. Like avatarUrl this is
   * session-derived and never persisted in the guest identity record.
   */
  socialUserId?: string | null;
}

const STORAGE_KEY = 'nightwatch:identity';
const MAX_NAME_LENGTH = 24;

export function sanitizeDisplayName(input: string): string {
  return input.trim().slice(0, MAX_NAME_LENGTH);
}

export function loadIdentity(): GuestIdentity | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as GuestIdentity).id === 'string' &&
      typeof (parsed as GuestIdentity).displayName === 'string'
    ) {
      return parsed as GuestIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

export function createIdentity(displayName: string): GuestIdentity {
  const identity: GuestIdentity = {
    id: crypto.randomUUID(),
    displayName: sanitizeDisplayName(displayName),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function updateDisplayName(identity: GuestIdentity, displayName: string): GuestIdentity {
  const updated: GuestIdentity = { ...identity, displayName: sanitizeDisplayName(displayName) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Attach (or clear) the session avatar on an identity WITHOUT persisting it —
 * the avatar is re-derived each launch from the auth session / platform
 * identity. Returns the same reference when nothing changes so a React state
 * setter can skip a needless re-render. The URL is validated here so an invalid
 * host can never reach presence.
 */
export function withAvatarUrl(identity: GuestIdentity, avatarUrl: string | null): GuestIdentity {
  const next = sanitizeAvatarUrl(avatarUrl);
  if ((identity.avatarUrl ?? null) === next) {
    return identity;
  }
  return { ...identity, avatarUrl: next };
}

/** Attach the signed-in social identity without persisting it to localStorage. */
export function withSocialUserId(
  identity: GuestIdentity,
  socialUserId: string | null,
): GuestIdentity {
  const next = sanitizeSocialUserId(socialUserId);
  if ((identity.socialUserId ?? null) === next) {
    return identity;
  }
  return { ...identity, socialUserId: next };
}
