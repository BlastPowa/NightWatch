import type { PresenceState } from '@shared/ipc';
import { getPlatformBridge } from '@/platform/PlatformBridge';

/**
 * Fire-and-forget presence updates, routed through the platform bridge
 * (Electron → Discord RPC; Activity/browser → no-op). Never throws.
 */
export function updateRichPresence(state: PresenceState | null): void {
  getPlatformBridge().updatePresence(state);
}
