import { describe, expect, it, vi } from 'vitest';
import { DriveWorkspace } from './driveWorkspace';

const okToken = async () => ({ ok: true as const, token: 'tok' });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DriveWorkspace.ensureWorkspace', () => {
  it('reuses an existing app-tagged folder', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          files: [{ id: 'folder1', name: 'NightWatch Shared', webViewLink: 'https://drive/x' }],
        }),
      );
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    const result = await workspace.ensureWorkspace();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('folder1');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Lookup is by app property, never by display name.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('appProperties');
  });

  it('creates the folder when none exists', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { files: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 'new1', name: 'NightWatch Shared', webViewLink: 'https://d/y' }),
      );
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    const result = await workspace.ensureWorkspace();
    expect(result.ok && result.value.folderId).toBe('new1');
  });

  it('maps expired tokens to auth-expired', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(401, {}));
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    const result = await workspace.ensureWorkspace();
    expect(!result.ok && result.error.code).toBe('auth-expired');
  });

  it('maps consent-required token refusals without touching the network', async () => {
    const fetchImpl = vi.fn();
    const workspace = new DriveWorkspace({
      getAccessToken: async () => ({ ok: false as const, reason: 'consent-required' }),
      fetchImpl,
    });
    const result = await workspace.ensureWorkspace();
    expect(!result.ok && result.error.code).toBe('auth-required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps network failure to offline', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    const result = await workspace.ensureWorkspace();
    expect(!result.ok && result.error.code).toBe('offline');
  });
});

describe('DriveWorkspace.probeFileAccess (per-viewer permission states)', () => {
  it('accessible only when the viewer can actually download', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { capabilities: { canDownload: true } }),
      );
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    expect(await workspace.probeFileAccess('a'.repeat(20))).toBe('accessible');
  });

  it('download-disabled files are permission-required, not accessible', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { capabilities: { canDownload: false } }),
      );
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    expect(await workspace.probeFileAccess('a'.repeat(20))).toBe('permission-required');
  });

  it('404 means the viewer must request access (Drive hides unshared files)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(404, {}));
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    expect(await workspace.probeFileAccess('a'.repeat(20))).toBe('permission-required');
  });

  it('401 means the viewer token is revoked/expired', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(401, {}));
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    expect(await workspace.probeFileAccess('a'.repeat(20))).toBe('revoked');
  });

  it('two viewers with different tokens get independent states', async () => {
    const grantedFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { capabilities: { canDownload: true } }));
    const deniedFetch = vi.fn().mockResolvedValueOnce(jsonResponse(404, {}));
    const granted = new DriveWorkspace({ getAccessToken: okToken, fetchImpl: grantedFetch });
    const denied = new DriveWorkspace({ getAccessToken: okToken, fetchImpl: deniedFetch });
    const fileId = 'b'.repeat(20);
    expect(await granted.probeFileAccess(fileId)).toBe('accessible');
    expect(await denied.probeFileAccess(fileId)).toBe('permission-required');
  });

  it('malformed file ids are not-found without a network call', async () => {
    const fetchImpl = vi.fn();
    const workspace = new DriveWorkspace({ getAccessToken: okToken, fetchImpl });
    expect(await workspace.probeFileAccess('../etc/passwd')).toBe('not-found');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
