import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AppInfo,
  type LogLevel,
  type NightWatchBridge,
  type NightWatchMediaBridge,
  type NotificationRequest,
  type PresenceState,
  type UpdateStatusMessage,
  type WindowState,
} from '@shared/ipc';
import type {
  HtmlMediaSourceDescriptor,
  MediaCapabilities,
  MediaResult,
  MediaSourceDescriptor,
} from '@shared/media';
import type {
  DriveConnectionState,
  FingerprintProgress,
  PlaybackLease,
  SelectedMedia,
} from '@shared/mediaBridge';

/**
 * Phase 29 media surface.
 *
 * Each method forwards to one fixed channel and nothing else. Arguments are
 * re-validated in main regardless of what happens here — a compromised renderer
 * can call these with anything, so preload is a convenience layer, never a
 * trust boundary.
 */
const media: NightWatchMediaBridge = {
  getCapabilities: (): Promise<MediaCapabilities> => {
    return ipcRenderer.invoke(IpcChannel.MediaGetCapabilities) as Promise<MediaCapabilities>;
  },
  pickLocalFile: (): Promise<MediaResult<SelectedMedia>> => {
    return ipcRenderer.invoke(IpcChannel.MediaPickLocalFile) as Promise<MediaResult<SelectedMedia>>;
  },
  resolveLocalMatch: (
    descriptor: Extract<MediaSourceDescriptor, { kind: 'local' }>,
  ): Promise<MediaResult<SelectedMedia>> => {
    return ipcRenderer.invoke(IpcChannel.MediaResolveLocalMatch, descriptor) as Promise<
      MediaResult<SelectedMedia>
    >;
  },
  cancelFingerprint: (operationId: string): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.MediaCancelFingerprint, operationId) as Promise<void>;
  },
  onFingerprintProgress: (callback: (progress: FingerprintProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: FingerprintProgress): void => {
      callback(progress);
    };
    ipcRenderer.on(IpcChannel.MediaFingerprintProgress, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannel.MediaFingerprintProgress, listener);
    };
  },
  getDriveConnection: (): Promise<DriveConnectionState> => {
    return ipcRenderer.invoke(IpcChannel.MediaGetDriveConnection) as Promise<DriveConnectionState>;
  },
  connectDrive: (): Promise<MediaResult<DriveConnectionState>> => {
    return ipcRenderer.invoke(IpcChannel.MediaConnectDrive) as Promise<
      MediaResult<DriveConnectionState>
    >;
  },
  pickDriveFile: (): Promise<MediaResult<SelectedMedia>> => {
    return ipcRenderer.invoke(IpcChannel.MediaPickDriveFile) as Promise<MediaResult<SelectedMedia>>;
  },
  disconnectDrive: (): Promise<MediaResult<void>> => {
    return ipcRenderer.invoke(IpcChannel.MediaDisconnectDrive) as Promise<MediaResult<void>>;
  },
  createPlaybackLease: (
    descriptor: HtmlMediaSourceDescriptor,
  ): Promise<MediaResult<PlaybackLease>> => {
    return ipcRenderer.invoke(IpcChannel.MediaCreateLease, descriptor) as Promise<
      MediaResult<PlaybackLease>
    >;
  },
  releasePlaybackLease: (leaseId: string): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.MediaReleaseLease, leaseId) as Promise<void>;
  },
};

/**
 * The single, minimal bridge between the sandboxed renderer and the main
 * process. Only the members of NightWatchBridge are ever exposed —
 * ipcRenderer itself is never handed to the renderer.
 */
const bridge: NightWatchBridge = {
  getAppInfo: (): Promise<AppInfo> => {
    return ipcRenderer.invoke(IpcChannel.GetAppInfo) as Promise<AppInfo>;
  },
  updatePresence: (state: PresenceState | null): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.PresenceUpdate, state) as Promise<void>;
  },
  checkForUpdates: (): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.UpdateCheck) as Promise<void>;
  },
  installUpdate: (): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.UpdateInstall) as Promise<void>;
  },
  onUpdateStatus: (callback: (status: UpdateStatusMessage) => void): (() => void) => {
    // Locked to the single update:status channel — the listener receives
    // only the payload, never the IpcRendererEvent.
    const listener = (_event: unknown, status: UpdateStatusMessage): void => {
      callback(status);
    };
    ipcRenderer.on(IpcChannel.UpdateStatus, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannel.UpdateStatus, listener);
    };
  },
  onAuthCallback: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: unknown, url: string): void => {
      if (typeof url === 'string' && url.startsWith('nightwatch://auth-callback')) {
        callback(url);
      }
    };
    ipcRenderer.on(IpcChannel.AuthCallback, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannel.AuthCallback, listener);
    };
  },
  onJoinLink: (callback: (code: string) => void): (() => void) => {
    const listener = (_event: unknown, code: string): void => {
      if (typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code)) {
        callback(code);
      }
    };
    ipcRenderer.on(IpcChannel.JoinLink, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannel.JoinLink, listener);
    };
  },
  notify: (request: NotificationRequest): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.NotifyShow, request) as Promise<void>;
  },
  log: (level: LogLevel, message: string): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.LogWrite, level, message) as Promise<void>;
  },
  getWindowState: (): Promise<WindowState> => {
    return ipcRenderer.invoke(IpcChannel.WindowGetState) as Promise<WindowState>;
  },
  onWindowState: (callback: (state: WindowState) => void): (() => void) => {
    const listener = (_event: unknown, state: WindowState): void => {
      callback(state);
    };
    ipcRenderer.on(IpcChannel.WindowState, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannel.WindowState, listener);
    };
  },
  media,
};

contextBridge.exposeInMainWorld('nightwatch', bridge);
