import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { IpcChannel, type UpdateStatusMessage } from '@shared/ipc';

const { autoUpdater } = electronUpdater;

const STARTUP_CHECK_DELAY_MS = 8000;

/**
 * Auto-update manager (ADR-016): wraps electron-updater against GitHub
 * Releases (configured in electron-builder.yml). Only active in packaged
 * builds; dev builds report state 'dev'.
 */
export class UpdateManager {
  private initialized = false;

  public constructor(private readonly getWindow: () => BrowserWindow | null) {}

  public init(): void {
    if (!app.isPackaged || this.initialized) {
      return;
    }
    this.initialized = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.send({ state: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      this.send({ state: 'available', version: info.version }),
    );
    autoUpdater.on('download-progress', (progress) =>
      this.send({ state: 'downloading', percent: Math.round(progress.percent) }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.send({ state: 'downloaded', version: info.version }),
    );
    autoUpdater.on('update-not-available', () => this.send({ state: 'up-to-date' }));
    autoUpdater.on('error', (error) =>
      this.send({ state: 'error', message: error.message.slice(0, 200) }),
    );

    // Quiet automatic check shortly after launch.
    setTimeout(() => {
      void this.check();
    }, STARTUP_CHECK_DELAY_MS);
  }

  public async check(): Promise<void> {
    if (!app.isPackaged) {
      this.send({ state: 'dev' });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // The 'error' event handler already reported it.
    }
  }

  public install(): void {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall();
    }
  }

  private send(status: UpdateStatusMessage): void {
    this.getWindow()?.webContents.send(IpcChannel.UpdateStatus, status);
  }
}
