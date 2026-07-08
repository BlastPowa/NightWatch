/**
 * Guest identity (ADR-005 fallback path). A stable id plus a display name,
 * persisted locally so the same person keeps their identity across launches.
 * Discord OAuth (the primary path) is added in a later phase and will layer
 * on top of this interface.
 */

export interface GuestIdentity {
  id: string;
  displayName: string;
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
