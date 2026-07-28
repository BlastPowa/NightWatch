import { describe, expect, it, vi } from 'vitest';
import { DriveWorkspaceService } from './driveWorkspaceService';

const ROOT = 'a'.repeat(20);
const FOLDER = 'b'.repeat(20);
const VIDEO = 'c'.repeat(20);

function serviceWith(fetchImpl: typeof fetch): DriveWorkspaceService {
  return new DriveWorkspaceService({
    getAccessToken: async () => ({ ok: true, token: 'not-exposed' }),
    ensureWorkspace: async () => ({ ok: true, value: { folderId: ROOT, name: 'NightWatch Shared', webViewLink: 'https://drive.google.com/folders/root' } }),
    fetchImpl,
    maxSizeBytes: () => 1024 * 1024,
    emitProgress: vi.fn(),
  });
}

describe('DriveWorkspaceService', () => {
  it('lists only root children and sanitizes Drive rows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      files: [
        { id: FOLDER, name: 'Films', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-07-28T10:00:00Z' },
        { id: VIDEO, name: 'Film.mp4', mimeType: 'video/mp4', size: '42', modifiedTime: '2026-07-28T10:00:00Z', capabilities: { canDownload: true }, thumbnailLink: 'https://lh3.googleusercontent.com/thumb' },
        { id: 'd'.repeat(20), name: 'Note.txt', mimeType: 'text/plain', modifiedTime: '2026-07-28T10:00:00Z' },
      ],
    }), { status: 200 }));
    const service = serviceWith(fetchImpl);
    const result = await service.list({ pageSize: 10 });
    expect(result.ok && result.value.entries).toHaveLength(2);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe(`'${ROOT}' in parents and trashed=false`);
  });

  it('does not allow a caller to jump to an arbitrary Drive folder id', async () => {
    const service = serviceWith(vi.fn() as unknown as typeof fetch);
    const result = await service.list({ folderId: 'z'.repeat(20) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('permission-denied');
  });

  it('only registers a Picker result after Drive confirms it is a folder', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: FOLDER, name: 'Explicitly shared', mimeType: 'application/vnd.google-apps.folder', webViewLink: 'https://drive.google.com/folders/folder',
    }), { status: 200 }));
    const service = serviceWith(fetchImpl);
    const result = await service.authorizePickerFolder(FOLDER);
    expect(result.ok && result.value.id).toBe(FOLDER);
  });

  it('rejects unsupported upload extensions before touching Drive', async () => {
    const service = serviceWith(vi.fn() as unknown as typeof fetch);
    const result = await service.uploadFile('C:\\movie.mkv', undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported-format');
  });
});
