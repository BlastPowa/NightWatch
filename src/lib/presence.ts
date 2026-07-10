import type { PresenceState } from '@shared/ipc';
import { settingsStore } from '@/lib/settings';
import { getPlatformBridge } from '@/platform/PlatformBridge';

/**
 * Fire-and-forget presence updates, routed through the platform bridge
 * (Electron → Discord RPC; Activity/browser → no-op). Respects the user's
 * Rich Presence setting. Never throws.
 */
export function updateRichPresence(state: PresenceState | null): void {
  if (state !== null && !settingsStore.get().richPresenceEnabled) {
    return;
  }
  getPlatformBridge().updatePresence(state);
}

// Clear presence immediately when the user switches the setting off.
settingsStore.subscribe((settings) => {
  if (!settings.richPresenceEnabled) {
    getPlatformBridge().updatePresence(null);
  }
});
