import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaOk } from '@shared/media';
import { IpcChannel } from '@shared/ipc';
import type { YouTubeAccountManager } from './youtubeAccount';

type Handler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  protocolHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { fromWebContents: () => null, fromId: () => null },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      electronMock.handlers.set(channel, handler);
    },
  },
  protocol: {
    handle: electronMock.protocolHandle,
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  logger: { write: vi.fn(), init: vi.fn() },
}));

const { MediaService } = await import('./service');

let workDir: string;
let savedFlag: string | undefined;
let savedClientId: string | undefined;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-yt-ipc-'));
  savedFlag = process.env['NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT'];
  savedClientId = process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'];
  delete process.env['NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT'];
  delete process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'];
  electronMock.handlers.clear();
  electronMock.protocolHandle.mockClear();
});

afterEach(async () => {
  if (savedFlag === undefined) {
    delete process.env['NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT'];
  } else {
    process.env['NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT'] = savedFlag;
  }
  if (savedClientId === undefined) {
    delete process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'];
  } else {
    process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'] = savedClientId;
  }
  await rm(workDir, { recursive: true, force: true });
});

function accountManager() {
  return {
    getState: vi.fn(async () => ({
      connected: true,
      channelTitle: 'Night Channel',
      reason: null,
    })),
    connect: vi.fn(async () =>
      mediaOk({
        connected: true,
        channelTitle: 'Night Channel',
        reason: null,
      }),
    ),
    disconnect: vi.fn(async () => mediaOk(undefined)),
    abortAuth: vi.fn(),
  };
}

async function createService(manager: ReturnType<typeof accountManager>) {
  const service = new MediaService(
    workDir,
    (event) => event.sender.id === 7,
    undefined,
    null,
    'app://nightwatch/picker.html',
    manager as unknown as YouTubeAccountManager,
  );
  await service.init();
  return service;
}

function handler(channel: string): Handler {
  const registered = electronMock.handlers.get(channel);
  if (registered === undefined) {
    throw new Error(`Missing IPC handler for ${channel}`);
  }
  return registered;
}

describe('YouTube account IPC', () => {
  it('delegates only when the explicit account capability is enabled', async () => {
    process.env['NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT'] = '1';
    process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'] =
      'client.apps.googleusercontent.com';
    const manager = accountManager();
    await createService(manager);
    const event = { sender: { id: 7 } };

    const state = await handler(IpcChannel.YouTubeAccountGetState)(event);
    const connected = await handler(IpcChannel.YouTubeAccountConnect)(event);
    const disconnected = await handler(IpcChannel.YouTubeAccountDisconnect)(
      event,
    );

    expect(state).toEqual({
      connected: true,
      channelTitle: 'Night Channel',
      reason: null,
    });
    expect(connected).toEqual(
      mediaOk({
        connected: true,
        channelTitle: 'Night Channel',
        reason: null,
      }),
    );
    expect(disconnected).toEqual(mediaOk(undefined));
    expect(manager.getState).toHaveBeenCalledOnce();
    expect(manager.connect).toHaveBeenCalledOnce();
    expect(manager.disconnect).toHaveBeenCalledOnce();
  });

  it('returns typed-off results while still allowing credential cleanup', async () => {
    const manager = accountManager();
    await createService(manager);
    const event = { sender: { id: 7 } };

    const state = await handler(IpcChannel.YouTubeAccountGetState)(event);
    const connected = await handler(IpcChannel.YouTubeAccountConnect)(event);
    const disconnected = await handler(IpcChannel.YouTubeAccountDisconnect)(
      event,
    );

    expect(state).toEqual({
      connected: false,
      channelTitle: null,
      reason: 'not-configured',
    });
    expect(connected).toMatchObject({
      ok: false,
      error: { code: 'capability-disabled' },
    });
    expect(disconnected).toEqual(mediaOk(undefined));
    expect(manager.getState).not.toHaveBeenCalled();
    expect(manager.connect).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects an unexpected renderer before calling the manager', async () => {
    process.env['NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT'] = '1';
    process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'] =
      'client.apps.googleusercontent.com';
    const manager = accountManager();
    await createService(manager);

    const result = await handler(IpcChannel.YouTubeAccountConnect)({
      sender: { id: 99 },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'capability-disabled' },
    });
    expect(manager.connect).not.toHaveBeenCalled();
  });
});
