import type { AppInfo, LogLevel, PresenceState } from '@shared/ipc';

/**
 * Platform adapter (§9, ADR-008): the renderer core talks to the host
 * platform (Electron, Discord Activity, plain browser) only through this
 * interface. Each build target installs its own implementation at startup.
 */
export interface PlatformBridge {
  readonly kind: 'electron' | 'discord' | 'web';
  /** App/runtime info, or null when the platform doesn't expose it. */
  getAppInfo(): Promise<AppInfo | null>;
  /** Rich Presence style status update; may be a no-op. */
  updatePresence(state: PresenceState | null): void;
  /** Platform logging sink (file on Electron, console elsewhere). */
  log(level: LogLevel, message: string): void;
  /**
   * Room code imposed by the platform (Discord voice channel → shared
   * room), or null when the user picks/creates rooms freely.
   */
  getFixedRoomCode(): Promise<string | null>;
}

/** Safe default: plain browser (dev tab) — everything is a no-op. */
export const webBridge: PlatformBridge = {
  kind: 'web',
  getAppInfo: () => Promise.resolve(null),
  updatePresence: () => {},
  log: (level, message) => {
    if (level === 'error') {
      console.error(`[nightwatch] ${message}`);
    }
  },
  getFixedRoomCode: () => Promise.resolve(null),
};

let currentBridge: PlatformBridge = webBridge;

export function setPlatformBridge(bridge: PlatformBridge): void {
  currentBridge = bridge;
}

export function getPlatformBridge(): PlatformBridge {
  return currentBridge;
}
