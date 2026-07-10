import type { PlatformBridge } from '@/platform/PlatformBridge';

/** Electron implementation: delegates to the preload bridge. */
export const electronBridge: PlatformBridge = {
  kind: 'electron',
  getAppInfo: async () => {
    try {
      return await window.nightwatch.getAppInfo();
    } catch {
      return null;
    }
  },
  updatePresence: (state) => {
    window.nightwatch.updatePresence(state).catch(() => {});
  },
  log: (level, message) => {
    if (level === 'error') {
      console.error(`[nightwatch] ${message}`);
    }
    window.nightwatch.log(level, message).catch(() => {});
  },
  getFixedRoomCode: () => Promise.resolve(null),
  // Electron identity flows through Supabase auth / guest names, not here.
  getPlatformIdentity: () => Promise.resolve(null),
};
