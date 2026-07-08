import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { IpcChannel, type AppInfo } from '@shared/ipc';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const RENDERER_INDEX = path.join(__dirname, '..', 'dist', 'index.html');

let mainWindow: BrowserWindow | null = null;

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
    if (!isDevServer && !isAppIndex) {
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
    void mainWindow.loadFile(RENDERER_INDEX);
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

  app.whenReady().then(() => {
    registerIpcHandlers();
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
}
