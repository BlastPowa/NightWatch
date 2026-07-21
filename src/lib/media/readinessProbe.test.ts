import { describe, expect, it, vi } from 'vitest';
import { evaluateReadiness, type ReadinessDeps } from './ReadinessProbe';

const LOCAL = {
  schemaVersion: 1 as const,
  kind: 'local' as const,
  fingerprint: `sha256:${'a'.repeat(64)}` as const,
  title: 'Movie.mp4',
  mimeType: 'video/mp4' as const,
  size: 1024,
};

const DRIVE = {
  schemaVersion: 1 as const,
  kind: 'drive' as const,
  fileId: 'd'.repeat(20),
  fingerprint: `sha256:${'b'.repeat(64)}` as const,
  title: 'Movie.mp4',
  mimeType: 'video/mp4' as const,
  size: 1024,
};

const YOUTUBE = { schemaVersion: 1 as const, kind: 'youtube' as const, videoId: 'dQw4w9WgXcQ' };

function deps(overrides: Partial<ReadinessDeps> = {}): ReadinessDeps {
  return {
    probeDriveAccess: vi.fn().mockResolvedValue('accessible'),
    resolveLocalMatch: vi.fn().mockResolvedValue({ ok: true, value: { descriptor: LOCAL, localHandle: 'x' } }),
    canPlayType: () => true,
    isOnline: () => true,
    ...overrides,
  };
}

describe('evaluateReadiness', () => {
  it('YouTube needs no per-participant authorization', async () => {
    expect((await evaluateReadiness(YOUTUBE, deps())).readiness).toBe('ready');
  });

  it('checks codec support before any network work', async () => {
    const probeDriveAccess = vi.fn();
    const result = await evaluateReadiness(
      DRIVE,
      deps({ canPlayType: () => false, probeDriveAccess }),
    );
    expect(result.readiness).toBe('unsupported-codec');
    expect(probeDriveAccess).not.toHaveBeenCalled();
  });

  it('maps every Drive access state onto a roster state', async () => {
    const cases: Array<[string, string]> = [
      ['accessible', 'ready'],
      ['permission-required', 'permission-required'],
      ['revoked', 'permission-required'],
      ['not-found', 'missing-file'],
      ['offline', 'offline'],
    ];
    for (const [access, expected] of cases) {
      const result = await evaluateReadiness(
        DRIVE,
        deps({ probeDriveAccess: vi.fn().mockResolvedValue(access) }),
      );
      expect(result.readiness).toBe(expected);
    }
  });

  it('reports offline for Drive without probing when the device is offline', async () => {
    const probeDriveAccess = vi.fn();
    const result = await evaluateReadiness(
      DRIVE,
      deps({ isOnline: () => false, probeDriveAccess }),
    );
    expect(result.readiness).toBe('offline');
    expect(probeDriveAccess).not.toHaveBeenCalled();
  });

  it('local match success is ready; a changed file is a fingerprint mismatch', async () => {
    expect((await evaluateReadiness(LOCAL, deps())).readiness).toBe('ready');

    const mismatch = await evaluateReadiness(
      LOCAL,
      deps({
        resolveLocalMatch: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'file-changed', message: '', retryable: false },
        }),
      }),
    );
    expect(mismatch.readiness).toBe('fingerprint-mismatch');
    expect(mismatch.detail).not.toBeNull();
  });

  it('an unmatched local file asks the viewer to select their own copy', async () => {
    const result = await evaluateReadiness(
      LOCAL,
      deps({
        resolveLocalMatch: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'file-missing', message: '', retryable: false },
        }),
      }),
    );
    expect(result.readiness).toBe('missing-file');
    expect(result.detail).toContain('your own copy');
  });

  it('propagates rate limiting from the local matcher', async () => {
    const result = await evaluateReadiness(
      LOCAL,
      deps({
        resolveLocalMatch: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'rate-limited', message: '', retryable: true },
        }),
      }),
    );
    expect(result.readiness).toBe('rate-limited');
  });
});
