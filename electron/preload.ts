import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AppInfo,
  type NightWatchBridge,
  type PresenceState,
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
};

contextBridge.exposeInMainWorld('nightwatch', bridge);
