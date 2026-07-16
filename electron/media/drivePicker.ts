/**
 * Phase 29 — the isolated Google Picker window.
 *
 * OAuth happens in the system browser, never here. This window exists only to
 * host Google's Picker UI, and it is built to know as little as possible:
 *
 *  - sandboxed, context-isolated, non-persistent partition, no Node;
 *  - a purpose-built preload exposing exactly getConfig() and report();
 *  - all navigation and window.open denied, all permission requests denied;
 *  - it receives one short-lived access token; the refresh token never
 *    leaves the main process;
 *  - it returns at most one file ID, which the main process treats as a hint:
 *    metadata is re-fetched and validated with the user's own token before
 *    anything is trusted;
 *  - it is destroyed — window and partition — on select, cancel, failure,
 *    parent close, or timeout.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { BrowserWindow, ipcMain, session } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { mediaFail, mediaOk, type MediaResult } from '@shared/media';

export interface PickerConfig {
  accessToken: string;
  pickerApiKey: string;
  appId: string;
}

const PICKER_TIMEOUT_MS = 5 * 60 * 1000;
const PICKER_PRELOAD_PATH = path.join(__dirname, 'pickerPreload.js');
/** Drive file ids: opaque, bounded shape. Same rule as the shared contract. */
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

export interface PickerHost {
  /** URL serving public/picker.html (app:// in prod, dev server in dev). */
  pickerPageUrl: string;
  parent: BrowserWindow | null;
}

/**
 * Show the Picker and resolve with the selected Drive file id.
 *
 * Returns `cancelled` for user cancellation and `picker-failed` for anything
 * that smells like the page misbehaving — including a malformed file id, which
 * is treated as a forged payload, not as something to sanitize and keep.
 */
export function pickDriveFileId(
  host: PickerHost,
  config: PickerConfig,
): Promise<MediaResult<string>> {
  return new Promise((resolve) => {
    // A fresh random partition per invocation, non-persistent ("no cache,
    // no cookies survive"), destroyed with the window.
    const partition = `picker-${randomBytes(8).toString('hex')}`;
    const pickerSession = session.fromPartition(partition);

    // The picker page needs no device permissions of any kind.
    pickerSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });

    const window = new BrowserWindow({
      width: 1050,
      height: 680,
      parent: host.parent ?? undefined,
      modal: host.parent !== null,
      autoHideMenuBar: true,
      title: 'Choose a Drive file',
      backgroundColor: '#0b0e14',
      webPreferences: {
        partition,
        preload: PICKER_PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    const pickerContentsId = window.webContents.id;
    let settled = false;

    const finish = (result: MediaResult<string>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      ipcMain.removeHandler(IpcChannel.PickerInit);
      ipcMain.removeListener(IpcChannel.PickerResult, onResult);
      if (!window.isDestroyed()) {
        window.destroy();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(mediaFail('cancelled', 'Choosing a Drive file took too long.'));
    }, PICKER_TIMEOUT_MS);

    // The init config — including the short-lived token — is answered only
    // for THIS window's webContents. Anything else asking gets null.
    ipcMain.handle(IpcChannel.PickerInit, (event): PickerConfig | null => {
      return event.sender.id === pickerContentsId ? config : null;
    });

    const onResult = (event: Electron.IpcMainEvent, selection: unknown): void => {
      if (event.sender.id !== pickerContentsId) {
        return;
      }
      if (typeof selection !== 'object' || selection === null) {
        finish(mediaFail('picker-failed', 'The Drive picker reported an unusable result.'));
        return;
      }
      const record = selection as Record<string, unknown>;
      switch (record['outcome']) {
        case 'picked': {
          const fileId = record['fileId'];
          if (typeof fileId === 'string' && DRIVE_FILE_ID_PATTERN.test(fileId)) {
            finish(mediaOk(fileId));
          } else {
            finish(mediaFail('picker-failed', 'The Drive picker reported an unusable result.'));
          }
          return;
        }
        case 'cancelled':
          finish(mediaFail('cancelled', 'No Drive file was selected.'));
          return;
        default:
          finish(mediaFail('picker-failed', 'The Drive picker reported an unusable result.'));
      }
    };
    ipcMain.on(IpcChannel.PickerResult, onResult);

    // The picker page is the only document this window may ever show.
    window.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    window.on('closed', () => {
      finish(mediaFail('cancelled', 'No Drive file was selected.'));
    });

    window.webContents.on('did-fail-load', () => {
      finish(mediaFail('picker-failed', 'The Drive picker could not be loaded.'));
    });

    void window.loadURL(host.pickerPageUrl);
  });
}
