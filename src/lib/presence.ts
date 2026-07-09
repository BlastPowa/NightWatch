import type { PresenceState } from '@shared/ipc';

/**
 * Fire-and-forget Rich Presence updates. No-ops outside Electron (browser
 * dev tab) and never throws — presence is cosmetic.
 */
export function updateRichPresence(state: PresenceState | null): void {
  if (typeof window.nightwatch === 'undefined') {
    return;
  }
  window.nightwatch.updatePresence(state).catch(() => {});
}
