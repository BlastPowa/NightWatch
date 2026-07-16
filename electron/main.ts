import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  Notification,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import {
  IpcChannel,
  type AppInfo,
  type LogLevel,
  type NotificationRequest,
  type PresenceState,
  type WindowState,
} from '@shared/ipc';
import { parseJoinLink } from '@shared/room';
import { logger } from './logger';
import { maxMediaSizeBytes } from './media/capabilities';
import { drivePublicConfiguration } from './media/buildConfig';
import { DriveManager } from './media/driveManager';
import { MediaService, makeSenderValidator, registerMediaScheme } from './media/service';
import { DriveTokenStore } from './media/tokenStore';
import { YouTubeAccountManager } from './media/youtubeAccount';
import { RichPresenceManager } from './richPresence';
import { UpdateManager } from './updater';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const RENDERER_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DEV_ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

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

// The private media scheme (Phase 29) must also be registered before 'ready'.
// It is registered in dev too, unlike app://, because local playback is
// developed against the dev server.
registerMediaScheme();

let mainWindow: BrowserWindow | null = null;

/**
 * Windows we created ourselves. IPC from anything else is refused — a sender
 * check against "is this a BrowserWindow" would happily accept a window some
 * other code opened.
 */
const knownWindowIds = new Set<number>();

let mediaService: MediaService | null = null;

// nightwatch:// protocol for the OAuth callback (Phase 14, ADR-005).
// Dev mode must pass the script path so Windows launches "electron ." .
if (process.defaultApp) {
  if (process.argv.length >= 2 && typeof process.argv[1] === 'string') {
    app.setAsDefaultProtocolClient('nightwatch', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('nightwatch');
}

function focusMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
}

/** Route any nightwatch:// deep link (auth callback or room invite). */
function handleDeepLink(url: string | undefined): void {
  if (typeof url !== 'string') {
    return;
  }
  if (url.startsWith('nightwatch://auth-callback')) {
    logger.write('info', 'main', 'OAuth callback received');
    mainWindow?.webContents.send(IpcChannel.AuthCallback, url);
    focusMainWindow();
    return;
  }
  const joinCode = parseJoinLink(url);
  if (joinCode !== null) {
    logger.write('info', 'main', `Invite link received for room ${joinCode}`);
    mainWindow?.webContents.send(IpcChannel.JoinLink, joinCode);
    focusMainWindow();
  }
}

function findDeepLink(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith('nightwatch://'));
}

// Note: must be dot-access — Vite only statically replaces import.meta.env.X.
const richPresence = new RichPresenceManager(import.meta.env.VITE_DISCORD_CLIENT_ID);
const updateManager = new UpdateManager(() => mainWindow);

function isValidNotificationRequest(value: unknown): value is NotificationRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const request = value as NotificationRequest;
  return (
    typeof request.title === 'string' &&
    request.title.length > 0 &&
    typeof request.body === 'string'
  );
}

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

/**
 * Custom title bar (Phase 21).
 *
 * The window buttons are drawn by the OS through `titleBarOverlay`, not by us.
 * Snap Layouts — the flyout when you hover the maximize button — requires
 * Windows to own that button, because it is driven by WM_NCHITTEST returning
 * HTMAXBUTTON, which Electron does not let a renderer answer. Hand-drawn HTML
 * controls under `frame: false` look identical and silently cost you Snap
 * Layouts, keyboard access, and high-contrast theming. The overlay is themed to
 * the brand instead, and the renderer owns everything to its left.
 *
 * macOS/Linux get the plain hidden bar; the renderer reads hasOverlay and lays
 * out accordingly.
 */
const TITLE_BAR_HEIGHT = 36;
const TITLE_BAR_BG = '#0b0e14';
const TITLE_BAR_SYMBOL = '#e6e8ee';
const hasWindowsOverlay = process.platform === 'win32';

function currentWindowState(): WindowState {
  return {
    isMaximized: mainWindow?.isMaximized() ?? false,
    hasOverlay: hasWindowsOverlay,
    height: TITLE_BAR_HEIGHT,
  };
}

function pushWindowState(): void {
  mainWindow?.webContents.send(IpcChannel.WindowState, currentWindowState());
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
    icon: app.isPackaged ? undefined : DEV_ICON_PATH,
    titleBarStyle: 'hidden',
    ...(hasWindowsOverlay
      ? {
          titleBarOverlay: {
            color: TITLE_BAR_BG,
            symbolColor: TITLE_BAR_SYMBOL,
            height: TITLE_BAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Showing the window must not depend on a single event.
  //
  // v0.1.19/v0.1.20 shipped a window nobody could see: with `show: false` and
  // `titleBarStyle: 'hidden'` + `titleBarOverlay`, 'ready-to-show' did not fire
  // on some Windows machines. The window was created, the renderer ran happily,
  // and the app sat there invisible with no error in any log — the worst class
  // of bug, because everything reports success.
  //
  // So the paint signal is now an optimisation, not the contract: whichever of
  // ready-to-show / did-finish-load arrives first reveals the window, and a
  // timer guarantees it regardless. An app that flashes an unpainted frame is a
  // blemish; an app that never appears is not an app.
  let shown = false;
  const reveal = (reason: string): void => {
    if (shown || mainWindow === null || mainWindow.isDestroyed()) {
      return;
    }
    shown = true;
    mainWindow.show();
    logger.write('info', 'main', `Window shown (${reason})`);
  };

  mainWindow.once('ready-to-show', () => reveal('ready-to-show'));
  mainWindow.webContents.once('did-finish-load', () => reveal('did-finish-load'));
  // Last resort: even a renderer that never finishes loading gets a window, so
  // the user sees the app (and any error it renders) instead of nothing at all.
  setTimeout(() => reveal('fallback timer'), 10_000);

  // The title bar squares off its corners when maximized, so it has to know.
  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  mainWindow.on('enter-full-screen', pushWindowState);
  mainWindow.on('leave-full-screen', pushWindowState);

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

  knownWindowIds.add(mainWindow.webContents.id);

  const closingWindowId = mainWindow.id;
  const closingContentsId = mainWindow.webContents.id;
  mainWindow.on('closed', () => {
    // Leases and in-flight hashing belong to the window that asked for them.
    mediaService?.handleWindowDestroyed(closingWindowId);
    knownWindowIds.delete(closingContentsId);
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

  ipcMain.handle(IpcChannel.NotifyShow, (_event, request: unknown): void => {
    if (!Notification.isSupported() || !isValidNotificationRequest(request)) {
      return;
    }
    const notification = new Notification({
      title: request.title.slice(0, 80),
      body: request.body.slice(0, 200),
    });
    // Clicking "your watch party is starting" should bring the app forward.
    notification.on('click', focusMainWindow);
    notification.show();
  });

  ipcMain.handle(IpcChannel.WindowGetState, (): WindowState => {
    return currentWindowState();
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
  app.on('second-instance', (_event, commandLine) => {
    // Windows delivers deep links via a second instance's argv.
    handleDeepLink(findDeepLink(commandLine));
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  // macOS-style delivery (harmless on Windows).
  app.on('open-url', (_event, url) => {
    handleDeepLink(url);
  });

  process.on('uncaughtException', (error) => {
    logger.write('error', 'main', `Uncaught exception: ${error.stack ?? error.message}`);
    dialog.showErrorBox('NightWatch error', error.message);
  });

  process.on('unhandledRejection', (reason) => {
    logger.write('error', 'main', `Unhandled rejection: ${String(reason)}`);
  });

  app.whenReady().then(async () => {
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

      // YouTube's embed checks want a real https referrer (error 153),
      // which app:// does not provide — rewrite YOUTUBE requests only.
      // Supabase must NOT be rewritten: Chromium validates CORS responses
      // against the app's true origin (app://nightwatch), so a rewritten
      // Origin makes Supabase reflect the wrong ACAO and every REST call
      // fails. Supabase gets a response-side ACAO override below instead.
      // NOTE: Electron honors only ONE onBeforeSendHeaders listener per
      // session — keep every header rewrite inside this single handler.
      const APP_ORIGIN = 'https://nightwatch.b00160446.workers.dev';
      session.defaultSession.webRequest.onBeforeSendHeaders(
        {
          urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'],
        },
        (details, callback) => {
          // Only rewrite requests originating from OUR document (app://) or
          // the embed frame document itself. YouTube's iframe-internal
          // requests must keep their natural headers, or its own API calls
          // start failing with 403 and playback breaks.
          const frameUrl = details.frame?.url ?? '';
          const fromApp = frameUrl.startsWith('app://');
          const isFrameDocument =
            details.resourceType === 'subFrame' || details.resourceType === 'mainFrame';
          if (fromApp || isFrameDocument) {
            details.requestHeaders['Referer'] = `${APP_ORIGIN}/`;
            details.requestHeaders['Origin'] = APP_ORIGIN;
          }
          callback({ requestHeaders: details.requestHeaders });
        },
      );

      // Supabase REST/Auth from the app:// origin: responses must satisfy
      // CORS against app://nightwatch, which Supabase never echoes. Force
      // a permissive ACAO (safe: anon key only, no cookie credentials).
      session.defaultSession.webRequest.onHeadersReceived(
        { urls: ['https://*.supabase.co/*'] },
        (details, callback) => {
          const headers = { ...details.responseHeaders };
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === 'access-control-allow-origin') {
              delete headers[key];
            }
          }
          headers['Access-Control-Allow-Origin'] = ['*'];
          callback({ responseHeaders: headers });
        },
      );
    }

    registerIpcHandlers();

    // Drive manager only when the desktop OAuth client is configured; without
    // it every Drive call answers typed 'not-configured'. Tokens are encrypted
    // by safeStorage; if the OS cannot encrypt, Drive stays disconnected —
    // there is no plaintext fallback.
    const driveConfig = drivePublicConfiguration();
    const driveManager =
      driveConfig.clientId.length > 0
        ? new DriveManager({
            fetchFn: (url, init) => net.fetch(url, init),
            config: {
              clientId: driveConfig.clientId,
              clientSecret: process.env['NIGHTWATCH_GOOGLE_CLIENT_SECRET'] ?? null,
            },
            pickerApiKey: driveConfig.pickerApiKey,
            appId: driveConfig.appId,
            tokenStore: new DriveTokenStore(app.getPath('userData'), safeStorage),
            maxSizeBytes: maxMediaSizeBytes,
          })
        : null;

    // YouTube account connection: same desktop OAuth client, its own scope
    // (youtube.readonly), its own consent, its own credential file.
    const youtubeAccountManager =
      driveConfig.clientId.length > 0
        ? new YouTubeAccountManager({
            fetchFn: (url, init) => net.fetch(url, init),
            config: {
              clientId: driveConfig.clientId,
              clientSecret: process.env['NIGHTWATCH_GOOGLE_CLIENT_SECRET'] ?? null,
            },
            tokenStore: new DriveTokenStore(
              app.getPath('userData'),
              safeStorage,
              'youtube-credentials.bin',
            ),
          })
        : null;

    mediaService = new MediaService(
      app.getPath('userData'),
      makeSenderValidator((webContentsId) => knownWindowIds.has(webContentsId)),
      undefined,
      driveManager,
      DEV_SERVER_URL ? `${DEV_SERVER_URL}picker.html` : 'app://nightwatch/picker.html',
      youtubeAccountManager,
    );
    // Register the private protocol and every media IPC handler before the
    // renderer can issue its first capability request.
    await mediaService.init();

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
    // Every lease expires with the app. On the next launch the renderer must
    // revalidate and ask for a new one.
    mediaService?.shutdown();
  });
}
