import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { IpcChannel, type AppInfo, type LogLevel, type PresenceState } from '@shared/ipc';
import { logger } from './logger';
import { RichPresenceManager } from './richPresence';
import { UpdateManager } from './updater';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const RENDERER_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const DIST_DIR = path.join(__dirname, '..', 'dist');

// Custom scheme for production: serves the renderer via app:// instead of
// file:// so embedded YouTube iframes see a valid HTTP-like origin (fixes
// IFrame API Error 153). Must be registered before app 'ready'.
if (!DEV_SERVER_URL) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

let mainWindow: BrowserWindow | null = null;

// Note: must be dot-access — Vite only statically replaces import.meta.env.X.
const richPresence = new RichPresenceManager(import.meta.env.VITE_DISCORD_CLIENT_ID);
const updateManager = new UpdateManager(() => mainWindow);

function isValidPresenceState(value: unknown): value is PresenceState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = value as PresenceState;
  return (
    typeof state.roomCode === 'string' &&
    state.roomCode.length <= 12 &&
    (state.videoTitle === null ||
      (typeof state.videoTitle === 'string' && state.videoTitle.length <= 300))
  );
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e14',
    title: 'NightWatch',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block in-window navigation away from the app itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = DEV_SERVER_URL !== undefined && url.startsWith(DEV_SERVER_URL);
    const isAppIndex = url === pathToFileURL(RENDERER_INDEX).href;
    const isCustomScheme = url.startsWith('app://nightwatch/');
    if (!isDevServer && !isAppIndex && !isCustomScheme) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL('app://nightwatch/index.html');
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.GetAppInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      platform: process.platform,
    };
  });

  ipcMain.handle(IpcChannel.PresenceUpdate, (_event, state: unknown): void => {
    if (state === null) {
      richPresence.update(null);
    } else if (isValidPresenceState(state)) {
      richPresence.update(state);
    }
  });

  ipcMain.handle(IpcChannel.UpdateCheck, async (): Promise<void> => {
    await updateManager.check();
  });

  ipcMain.handle(IpcChannel.UpdateInstall, (): void => {
    updateManager.install();
  });

  const LOG_LEVELS: readonly string[] = ['info', 'warn', 'error'];
  ipcMain.handle(IpcChannel.LogWrite, (_event, level: unknown, message: unknown): void => {
    if (typeof level === 'string' && LOG_LEVELS.includes(level) && typeof message === 'string') {
      logger.write(level as LogLevel, 'renderer', message.slice(0, 2000));
    }
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  process.on('uncaughtException', (error) => {
    logger.write('error', 'main', `Uncaught exception: ${error.stack ?? error.message}`);
    dialog.showErrorBox('NightWatch error', error.message);
  });

  process.on('unhandledRejection', (reason) => {
    logger.write('error', 'main', `Unhandled rejection: ${String(reason)}`);
  });

  app.whenReady().then(() => {
    logger.init();
    logger.write('info', 'main', `NightWatch ${app.getVersion()} starting (packaged=${app.isPackaged})`);

    // Register the app:// protocol handler that serves renderer files.
    if (!DEV_SERVER_URL) {
      protocol.handle('app', (request) => {
        const url = new URL(request.url);
        // Map app://nightwatch/path → dist/path
        let filePath = path.join(DIST_DIR, decodeURIComponent(url.pathname));
        // Default to index.html for the root
        if (filePath.endsWith(path.sep) || filePath === DIST_DIR) {
          filePath = path.join(DIST_DIR, 'index.html');
        }
        // Containment guard: never serve anything outside dist/.
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(DIST_DIR))) {
          return new Response(null, { status: 404 });
        }
        return net.fetch(pathToFileURL(resolved).href);
      });

      // The app:// scheme sends "Origin: app://nightwatch", which external
      // services reject: Supabase drops the realtime WebSocket handshake
      // (visible as endless "WebSocket connection failed"), and YouTube's
      // embed checks want a real https referrer (error 153). Present a
      // stable https origin (our Activity domain) to both instead.
      // NOTE: Electron honors only ONE onBeforeSendHeaders listener per
      // session — keep every header rewrite inside this single handler.
      const APP_ORIGIN = 'https://nightwatch.b00160446.workers.dev';
      session.defaultSession.webRequest.onBeforeSendHeaders(
        {
          urls: [
            'https://www.youtube.com/*',
            'https://www.youtube-nocookie.com/*',
            'https://*.supabase.co/*',
            'wss://*.supabase.co/*',
          ],
        },
        (details, callback) => {
          details.requestHeaders['Referer'] = `${APP_ORIGIN}/`;
          details.requestHeaders['Origin'] = APP_ORIGIN;
          callback({ requestHeaders: details.requestHeaders });
        },
      );
    }

    registerIpcHandlers();
    richPresence.start();
    updateManager.init();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    richPresence.stop();
  });
}
