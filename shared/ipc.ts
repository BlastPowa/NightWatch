/**
 * Typed IPC contract shared by the Electron main process, the preload
 * bridge, and the renderer. All IPC in NightWatch flows through the
 * channels defined here — no ad-hoc channel strings anywhere else.
 */

export const IpcChannel = {
  GetAppInfo: 'app:get-info',
  PresenceUpdate: 'presence:update',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

/** Basic information about the running application. */
export interface AppInfo {
  /** Application version from package.json. */
  version: string;
  /** Electron runtime version. */
  electronVersion: string;
  /** Operating system platform (e.g. "win32"). */
  platform: NodeJS.Platform;
}

/** Discord Rich Presence state reported by the renderer (§7.5). */
export interface PresenceState {
  roomCode: string;
  videoTitle: string | null;
}

/**
 * Maps each invoke-style channel to its request arguments and response
 * type. Extending IPC in later phases means adding an entry here and a
 * matching handler in electron/main.ts.
 */
export interface IpcInvokeContract {
  [IpcChannel.GetAppInfo]: {
    args: [];
    result: AppInfo;
  };
  [IpcChannel.PresenceUpdate]: {
    args: [PresenceState | null];
    result: void;
  };
}

/**
 * The API surface exposed to the renderer on `window.nightwatch` by the
 * preload script. Renderer code must depend on this interface only.
 */
export interface NightWatchBridge {
  getAppInfo(): Promise<AppInfo>;
  /** Update (or clear with null) Discord Rich Presence. */
  updatePresence(state: PresenceState | null): Promise<void>;
}
