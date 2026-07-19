import { desktopCapturer, ipcMain, session, type BrowserWindow } from 'electron';
import { isCaptureSourceId, type CaptureSourceSummary } from '@shared/rtc';
import { IpcChannel } from '@shared/ipc';

/**
 * Phase 32 — Electron screen/window capture plumbing (handoff §4).
 *
 * Model: the renderer asks for the source LIST (names + thumbnail data URLs
 * only), the user picks one in NightWatch's own UI, the renderer registers
 * that choice here, and only then does it call getDisplayMedia — which the
 * display-media handler resolves to exactly the chosen source. No silent
 * capture is possible: without a registered, recently-chosen source the
 * handler denies the request outright.
 */

const CHOICE_TTL_MS = 30_000;

let chosen: { sourceId: string; atMs: number } | null = null;

async function listSources(): Promise<CaptureSourceSummary[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((source) => isCaptureSourceId(source.id))
    .map((source) => ({
      id: source.id,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      name: source.name.slice(0, 120),
      thumbnailDataUrl: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    }));
}

/**
 * Install IPC handlers and the display-media handler. Call once at app
 * startup, before any renderer can request capture.
 */
export function registerCaptureSupport(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IpcChannel.CaptureListSources, async (event) => {
    if (event.sender !== getWindow()?.webContents) {
      return [];
    }
    try {
      return await listSources();
    } catch {
      return [];
    }
  });

  ipcMain.handle(IpcChannel.CaptureChooseSource, (event, sourceId: unknown): boolean => {
    if (event.sender !== getWindow()?.webContents || !isCaptureSourceId(sourceId)) {
      return false;
    }
    chosen = { sourceId, atMs: Date.now() };
    return true;
  });

  ipcMain.handle(IpcChannel.CaptureClearSource, (event): void => {
    if (event.sender === getWindow()?.webContents) {
      chosen = null;
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const window = getWindow();
      const fromApp =
        window !== null && request.frame === window.webContents.mainFrame;
      const fresh =
        chosen !== null && Date.now() - chosen.atMs < CHOICE_TTL_MS ? chosen : null;
      if (!fromApp || fresh === null) {
        // Explicit denial: no picked source, no capture (handoff §4).
        callback({});
        return;
      }
      const sourceId = fresh.sourceId;
      chosen = null; // single-use: a second capture needs a second pick
      void desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const match = sources.find((source) => source.id === sourceId);
          if (match === undefined) {
            callback({});
            return;
          }
          // Omitting `audio` is Electron's typed way to deny system-audio
          // capture. (`false` is not a valid DisplayMediaRequestHandler value.)
          callback({ video: match });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}
