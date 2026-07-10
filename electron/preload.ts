import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AppInfo,
  type LogLevel,
  type NightWatchBridge,
  type PresenceState,
  type UpdateStatusMessage,
} from '@shared/ipc';

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
  log: (level: LogLevel, message: string): Promise<void> => {
    return ipcRenderer.invoke(IpcChannel.LogWrite, level, message) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('nightwatch', bridge);
