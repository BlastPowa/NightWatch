/**
 * Typed IPC contract shared by the Electron main process, the preload
 * bridge, and the renderer. All IPC in NightWatch flows through the
 * channels defined here — no ad-hoc channel strings anywhere else.
 */

export const IpcChannel = {
  GetAppInfo: 'app:get-info',
  PresenceUpdate: 'presence:update',
  UpdateCheck: 'update:check',
  UpdateInstall: 'update:install',
  /** Push channel (main → renderer) carrying UpdateStatusMessage. */
  UpdateStatus: 'update:status',
  /** Push channel (main → renderer) carrying the OAuth deep-link URL. */
  AuthCallback: 'auth:callback',
  /** Push channel (main → renderer) carrying a room code from an invite. */
  JoinLink: 'join:link',
  LogWrite: 'log:write',
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

/** Auto-update status pushed from main to the renderer (ADR-016). */
export interface UpdateStatusMessage {
  state:
    | 'dev'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'up-to-date'
    | 'error';
  /** New version, when known (available/downloading/downloaded). */
  version?: string;
  /** Download progress 0–100 (downloading only). */
  percent?: number;
  /** Human-readable error (error only). */
  message?: string;
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
  [IpcChannel.UpdateCheck]: {
    args: [];
    result: void;
  };
  [IpcChannel.UpdateInstall]: {
    args: [];
    result: void;
  };
  [IpcChannel.LogWrite]: {
    args: [LogLevel, string];
    result: void;
  };
}

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * The API surface exposed to the renderer on `window.nightwatch` by the
 * preload script. Renderer code must depend on this interface only.
 */
export interface NightWatchBridge {
  getAppInfo(): Promise<AppInfo>;
  /** Update (or clear with null) Discord Rich Presence. */
  updatePresence(state: PresenceState | null): Promise<void>;
  /** Trigger an update check; results arrive via onUpdateStatus. */
  checkForUpdates(): Promise<void>;
  /** Quit and install a downloaded update. */
  installUpdate(): Promise<void>;
  /** Subscribe to update status pushes. Returns an unsubscribe fn. */
  onUpdateStatus(callback: (status: UpdateStatusMessage) => void): () => void;
  /** Subscribe to OAuth deep-link callbacks (nightwatch://auth-callback). */
  onAuthCallback(callback: (url: string) => void): () => void;
  /** Subscribe to invite deep links (nightwatch://join/CODE). */
  onJoinLink(callback: (code: string) => void): () => void;
  /** Append a line to the local log file (fire-and-forget). */
  log(level: LogLevel, message: string): Promise<void>;
}
