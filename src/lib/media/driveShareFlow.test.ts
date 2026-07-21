import { describe, expect, it, vi } from 'vitest';
import { DriveShareFlow, probeViewerAccess, type DriveShareBridge } from './DriveShareFlow';

const CONNECTED = { connected: true, accountEmail: 'host@example.com', reason: null };
const DISCONNECTED = { connected: false, accountEmail: null, reason: null };

const WORKSPACE = {
  folderId: 'folder-1',
  name: 'NightWatch Shared',
  webViewLink: 'https://drive.google.com/drive/folders/folder-1',
};

const SELECTION = {
  descriptor: {
    schemaVersion: 1 as const,
    kind: 'drive' as const,
    fileId: 'a'.repeat(20),
    fingerprint: `sha256:${'b'.repeat(64)}` as const,
    title: 'Movie.mp4',
    mimeType: 'video/mp4' as const,
    size: 2048,
  },
  localHandle: 'c'.repeat(32),
};

function makeBridge(overrides: Partial<DriveShareBridge> = {}): DriveShareBridge {
  return {
    getDriveConnection: vi.fn().mockResolvedValue(DISCONNECTED),
    connectDrive: vi.fn().mockResolvedValue({ ok: true, value: CONNECTED }),
    ensureDriveWorkspace: vi.fn().mockResolvedValue({ ok: true, value: WORKSPACE }),
    pickDriveFile: vi.fn().mockResolvedValue({ ok: true, value: SELECTION }),
    getDriveFileAccess: vi.fn().mockResolvedValue('accessible'),
    openExternal: vi.fn(),
    ...overrides,
  };
}

describe('DriveShareFlow host journey', () => {
  it('walks connect → workspace → add-file → share → pick → publish', async () => {
    const bridge = makeBridge();
    const flow = new DriveShareFlow(bridge, () => {});

    await flow.initialize();
    expect(flow.getState().step).toBe('connect');

    expect(await flow.connect()).toBe(true);
    expect(flow.getState().step).toBe('workspace');

    expect(await flow.openWorkspace()).toBe(true);
    expect(flow.getState().step).toBe('add-file');
    expect(flow.getState().workspace?.folderId).toBe('folder-1');

    flow.openWorkspaceInDrive();
    expect(bridge.openExternal).toHaveBeenCalledWith(WORKSPACE.webViewLink);

    flow.confirmFileAdded();
    expect(flow.getState().step).toBe('share-access');

    flow.confirmAccessShared();
    expect(flow.getState().step).toBe('pick-file');

    expect(await flow.pickFile()).toBe(true);
    expect(flow.getState().step).toBe('publish');

    const descriptor = flow.takeDescriptorForPublish();
    expect(descriptor?.kind).toBe('drive');
    expect(flow.getState().step).toBe('done');
  });

  it('skips the connect step when Drive is already connected', async () => {
    const flow = new DriveShareFlow(
      makeBridge({ getDriveConnection: vi.fn().mockResolvedValue(CONNECTED) }),
      () => {},
    );
    await flow.initialize();
    expect(flow.getState().step).toBe('workspace');
  });

  it('sends the host back to connect when the session expires mid-flow', async () => {
    const bridge = makeBridge({
      getDriveConnection: vi.fn().mockResolvedValue(CONNECTED),
      ensureDriveWorkspace: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'auth-expired', message: 'expired', retryable: true },
      }),
    });
    const flow = new DriveShareFlow(bridge, () => {});
    await flow.initialize();
    expect(await flow.openWorkspace()).toBe(false);
    const state = flow.getState();
    expect(state.step).toBe('connect');
    expect(state.error?.code).toBe('auth-expired');
  });

  it('keeps the step and surfaces a retryable error when Drive is offline', async () => {
    const bridge = makeBridge({
      getDriveConnection: vi.fn().mockResolvedValue(CONNECTED),
      ensureDriveWorkspace: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'offline', message: 'offline', retryable: true },
      }),
    });
    const flow = new DriveShareFlow(bridge, () => {});
    await flow.initialize();
    await flow.openWorkspace();
    expect(flow.getState().step).toBe('workspace');
    expect(flow.getState().error?.retryable).toBe(true);
  });

  it('refuses to publish before a file is picked', () => {
    const flow = new DriveShareFlow(makeBridge(), () => {});
    expect(flow.takeDescriptorForPublish()).toBeNull();
  });

  it('emits a state snapshot on every transition', async () => {
    const seen: string[] = [];
    const flow = new DriveShareFlow(makeBridge(), (state) => seen.push(state.step));
    await flow.initialize();
    await flow.connect();
    await flow.openWorkspace();
    expect(seen).toContain('workspace');
    expect(seen).toContain('add-file');
  });
});

describe('probeViewerAccess', () => {
  it('returns the platform access state verbatim (no silent grants)', async () => {
    const bridge = makeBridge({
      getDriveFileAccess: vi.fn().mockResolvedValue('permission-required'),
    });
    expect(await probeViewerAccess(bridge, 'a'.repeat(20))).toBe('permission-required');
  });
});
