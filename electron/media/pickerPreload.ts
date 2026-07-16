import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '@shared/ipc';

/**
 * The Picker window's entire preload surface: fetch the init config once,
 * report one result once. No generic IPC, no Node, nothing else.
 *
 * The access token this hands the page is short-lived and scoped to
 * drive.file; the refresh token never leaves the main process.
 */
export interface PickerInitConfig {
  accessToken: string;
  pickerApiKey: string;
  appId: string;
}

export interface PickerSelection {
  /** 'picked' carries a fileId; the others carry nothing. */
  outcome: 'picked' | 'cancelled' | 'failed';
  fileId?: string;
}

contextBridge.exposeInMainWorld('nightwatchPicker', {
  getConfig: (): Promise<PickerInitConfig | null> => {
    return ipcRenderer.invoke(IpcChannel.PickerInit) as Promise<PickerInitConfig | null>;
  },
  report: (selection: PickerSelection): void => {
    ipcRenderer.send(IpcChannel.PickerResult, selection);
  },
});
