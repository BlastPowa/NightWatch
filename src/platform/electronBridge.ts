import type { MediaPlatformBridge } from '@shared/mediaBridge';
import type { PlatformBridge } from '@/platform/PlatformBridge';

/**
 * The desktop media surface. A thin pass-through: every decision — capability
 * gating, validation, permission — is made in the main process, because that is
 * the only side of the bridge whose code the user cannot reach.
 */
const media: MediaPlatformBridge = {
  getCapabilities: () => window.nightwatch.media.getCapabilities(),
  pickLocalFile: () => window.nightwatch.media.pickLocalFile(),
  resolveLocalMatch: (descriptor) => window.nightwatch.media.resolveLocalMatch(descriptor),
  getDriveConnection: () => window.nightwatch.media.getDriveConnection(),
  connectDrive: () => window.nightwatch.media.connectDrive(),
  cancelDriveConnect: () => window.nightwatch.media.cancelDriveConnect(),
  ensureDriveWorkspace: () => window.nightwatch.media.ensureDriveWorkspace(),
  openDriveWorkspace: () => window.nightwatch.media.openDriveWorkspace(),
  pickDriveFile: () => window.nightwatch.media.pickDriveFile(),
  disconnectDrive: () => window.nightwatch.media.disconnectDrive(),
  createPlaybackLease: (descriptor) => window.nightwatch.media.createPlaybackLease(descriptor),
  releasePlaybackLease: (leaseId) => window.nightwatch.media.releasePlaybackLease(leaseId),
  onFingerprintProgress: (callback) => window.nightwatch.media.onFingerprintProgress(callback),
  cancelFingerprint: (operationId) => window.nightwatch.media.cancelFingerprint(operationId),
};

/** Electron implementation: delegates to the preload bridge. */
export const electronBridge: PlatformBridge = {
  kind: 'electron',
  media,
  youtubeAccount: {
    getState: () => window.nightwatch.youtubeAccount.getState(),
    connect: () => window.nightwatch.youtubeAccount.connect(),
    disconnect: () => window.nightwatch.youtubeAccount.disconnect(),
  },
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
  getWindowState: async () => {
    try {
      return await window.nightwatch.getWindowState();
    } catch {
      return null;
    }
  },
  onWindowState: (callback) => window.nightwatch.onWindowState(callback),
  getFixedRoomCode: () => Promise.resolve(null),
  // Electron identity flows through Supabase auth / guest names, not here.
  getPlatformIdentity: () => Promise.resolve(null),
  notify: (request) => {
    window.nightwatch.notify(request).catch(() => {});
  },
};
