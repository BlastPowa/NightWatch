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
  /** Desktop notification (e.g. a scheduled watch party is starting). */
  NotifyShow: 'notify:show',
  LogWrite: 'log:write',
  /** Current window chrome geometry/state (Phase 21 custom title bar). */
  WindowGetState: 'window:get-state',
  /** Push channel (main → renderer) carrying WindowState on change. */
  WindowState: 'window:state',
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
 * Window chrome state for the custom title bar (Phase 21).
 *
 * The window controls themselves are drawn by Windows via `titleBarOverlay`,
 * not by us. That is deliberate: Snap Layouts (the flyout on hover over the
 * maximize button) depends on Windows knowing where that button is, which it
 * can only do when it owns the button. Hand-drawn HTML controls with
 * `frame: false` look identical and silently break Snap Layouts, keyboard
 * access, and high-contrast themes.
 *
 * So the renderer does not need minimize/maximize/close IPC — it needs to know
 * how much room the OS took, so the brand bar can lay out beside it rather than
 * underneath it.
 */
export interface WindowState {
  /** True while maximized — the title bar squares off its corners. */
  isMaximized: boolean;
  /** True when the OS is drawing overlay controls we must not overlap. */
  hasOverlay: boolean;
  /** Height of the title bar area in CSS px. */
  height: number;
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
  [IpcChannel.NotifyShow]: {
    args: [NotificationRequest];
    result: void;
  };
  [IpcChannel.LogWrite]: {
    args: [LogLevel, string];
    result: void;
  };
  [IpcChannel.WindowGetState]: {
    args: [];
    result: WindowState;
  };
}

/** A desktop notification raised by the renderer (Phase 19). */
export interface NotificationRequest {
  title: string;
  body: string;
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
  /** Raise a desktop notification (fire-and-forget). */
  notify(request: NotificationRequest): Promise<void>;
  /** Append a line to the local log file (fire-and-forget). */
  log(level: LogLevel, message: string): Promise<void>;
  /** Current window chrome state (custom title bar). */
  getWindowState(): Promise<WindowState>;
  /** Subscribe to window state changes (maximize/restore). Returns unsubscribe. */
  onWindowState(callback: (state: WindowState) => void): () => void;
}
