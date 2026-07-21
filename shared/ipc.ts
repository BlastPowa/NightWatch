/**
 * Typed IPC contract shared by the Electron main process, the preload
 * bridge, and the renderer. All IPC in NightWatch flows through the
 * channels defined here — no ad-hoc channel strings anywhere else.
 */

import type {
  HtmlMediaSourceDescriptor,
  MediaCapabilities,
  MediaResult,
  MediaSourceDescriptor,
} from './media';
import type {
  DriveConnectionState,
  DriveWorkspaceInfo,
  FingerprintProgress,
  PlaybackLease,
  SelectedMedia,
  YouTubeAccountState,
} from './mediaBridge';

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

  // Phase 29 — authorized media. One named channel per operation: the preload
  // never exposes a generic send/invoke, so the renderer cannot reach any main
  // process capability that is not spelled out here.
  MediaGetCapabilities: 'media:get-capabilities',
  MediaPickLocalFile: 'media:pick-local-file',
  MediaResolveLocalMatch: 'media:resolve-local-match',
  MediaCancelFingerprint: 'media:cancel-fingerprint',
  /** Push channel (main → renderer) carrying FingerprintProgress. */
  MediaFingerprintProgress: 'media:fingerprint-progress',
  MediaGetDriveConnection: 'media:get-drive-connection',
  MediaConnectDrive: 'media:connect-drive',
  MediaCancelDriveConnect: 'media:cancel-drive-connect',
  MediaEnsureDriveWorkspace: 'media:ensure-drive-workspace',
  MediaOpenDriveWorkspace: 'media:open-drive-workspace',
  MediaPickDriveFile: 'media:pick-drive-file',
  MediaDisconnectDrive: 'media:disconnect-drive',
  MediaCreateLease: 'media:create-lease',
  MediaReleaseLease: 'media:release-lease',

  // YouTube account connection (Settings → Account). Same one-named-channel
  // rule as media; read-only scope; tokens never cross this boundary.
  YouTubeAccountGetState: 'youtube-account:get-state',
  YouTubeAccountConnect: 'youtube-account:connect',
  YouTubeAccountDisconnect: 'youtube-account:disconnect',

  // Picker-window-only channels (Phase 29). These are answered ONLY for the
  // dedicated sandboxed Picker window's webContents — the app renderer never
  // sees them, and the picker preload exposes nothing else.
  PickerInit: 'picker:init',
  PickerResult: 'picker:result',

  // Phase 32: screen/window capture for live-share. The renderer lists
  // sources (name + thumbnail only), the user picks one explicitly, and the
  // main-process display-media handler serves exactly that source to the
  // next getDisplayMedia call. No native handles cross the bridge.
  CaptureListSources: 'capture:list-sources',
  CaptureChooseSource: 'capture:choose-source',
  CaptureClearSource: 'capture:clear-source',

  // Phase 32: Google Drive shared workspace (handoff §2).
  MediaGetDriveFileAccess: 'media:get-drive-file-access',
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
  [IpcChannel.MediaGetCapabilities]: {
    args: [];
    result: MediaCapabilities;
  };
  [IpcChannel.MediaPickLocalFile]: {
    args: [];
    result: MediaResult<SelectedMedia>;
  };
  [IpcChannel.MediaResolveLocalMatch]: {
    args: [Extract<MediaSourceDescriptor, { kind: 'local' }>];
    result: MediaResult<SelectedMedia>;
  };
  [IpcChannel.MediaCancelFingerprint]: {
    args: [string];
    result: void;
  };
  [IpcChannel.MediaGetDriveConnection]: {
    args: [];
    result: DriveConnectionState;
  };
  [IpcChannel.MediaConnectDrive]: {
    args: [];
    result: MediaResult<DriveConnectionState>;
  };
  [IpcChannel.MediaCancelDriveConnect]: {
    args: [];
    result: void;
  };
  [IpcChannel.MediaEnsureDriveWorkspace]: {
    args: [];
    result: MediaResult<DriveWorkspaceInfo>;
  };
  [IpcChannel.MediaOpenDriveWorkspace]: {
    args: [];
    result: MediaResult<DriveWorkspaceInfo>;
  };
  [IpcChannel.MediaPickDriveFile]: {
    args: [];
    result: MediaResult<SelectedMedia>;
  };
  [IpcChannel.MediaDisconnectDrive]: {
    args: [];
    result: MediaResult<void>;
  };
  [IpcChannel.MediaCreateLease]: {
    args: [HtmlMediaSourceDescriptor];
    result: MediaResult<PlaybackLease>;
  };
  [IpcChannel.MediaReleaseLease]: {
    args: [string];
    result: void;
  };
  [IpcChannel.YouTubeAccountGetState]: {
    args: [];
    result: YouTubeAccountState;
  };
  [IpcChannel.YouTubeAccountConnect]: {
    args: [];
    result: MediaResult<YouTubeAccountState>;
  };
  [IpcChannel.YouTubeAccountDisconnect]: {
    args: [];
    result: MediaResult<void>;
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
  /** Phase 29 authorized-media surface. */
  media: NightWatchMediaBridge;
  /** Phase 32 screen/window capture surface (live-share). */
  capture: NightWatchCaptureBridge;
  /** YouTube account connection (read-only scope; Settings → Account). */
  youtubeAccount: {
    getState(): Promise<YouTubeAccountState>;
    connect(): Promise<MediaResult<YouTubeAccountState>>;
    disconnect(): Promise<MediaResult<void>>;
  };
}

/**
 * The media half of the preload bridge.
 *
 * Every method maps to exactly one named channel. There is no path argument
 * anywhere in this interface and no way to ask for one — the renderer selects
 * files through the OS dialog the main process owns, and refers to the result
 * only by opaque handle.
 */
export interface NightWatchMediaBridge {
  getCapabilities(): Promise<MediaCapabilities>;
  pickLocalFile(): Promise<MediaResult<SelectedMedia>>;
  resolveLocalMatch(
    descriptor: Extract<MediaSourceDescriptor, { kind: 'local' }>,
  ): Promise<MediaResult<SelectedMedia>>;
  cancelFingerprint(operationId: string): Promise<void>;
  onFingerprintProgress(callback: (progress: FingerprintProgress) => void): () => void;
  getDriveConnection(): Promise<DriveConnectionState>;
  connectDrive(): Promise<MediaResult<DriveConnectionState>>;
  cancelDriveConnect(): Promise<void>;
  ensureDriveWorkspace(): Promise<MediaResult<DriveWorkspaceInfo>>;
  openDriveWorkspace(): Promise<MediaResult<DriveWorkspaceInfo>>;
  pickDriveFile(): Promise<MediaResult<SelectedMedia>>;
  disconnectDrive(): Promise<MediaResult<void>>;
  createPlaybackLease(descriptor: HtmlMediaSourceDescriptor): Promise<MediaResult<PlaybackLease>>;
  releasePlaybackLease(leaseId: string): Promise<void>;
  /** Phase 32: THIS viewer's access state for one Drive file id. */
  getDriveFileAccess(fileId: string): Promise<DriveFileAccessState>;
}

/** Phase 32 Drive workspace surface (see electron/media/driveWorkspace.ts). */
export type DriveFileAccessState =
  | 'accessible'
  | 'permission-required'
  | 'revoked'
  | 'not-found'
  | 'offline';

/** Phase 32 screen/window capture surface (renderer picks, main serves). */
export interface NightWatchCaptureBridge {
  listSources(): Promise<
    Array<{ id: string; kind: 'screen' | 'window'; name: string; thumbnailDataUrl: string }>
  >;
  /** Register the user's explicit pick; valid for one capture, 30s. */
  chooseSource(sourceId: string): Promise<boolean>;
  clearSource(): Promise<void>;
}
