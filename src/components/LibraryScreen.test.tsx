// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaCapabilities } from '@shared/media';
import type { MediaPlatformBridge } from '@shared/mediaBridge';
import { LibraryScreen } from '@/components/LibraryScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const capabilities: MediaCapabilities = {
  youtube: true,
  htmlMedia: true,
  localFiles: true,
  googleDrive: false,
  library: true,
  mediaProtocolVersions: [1],
  reasons: {
    htmlMedia: 'available',
    localFiles: 'available',
    googleDrive: 'disabled-by-owner',
    library: 'available',
  },
};

function makeBridge(): MediaPlatformBridge {
  return {
    getCapabilities: vi.fn().mockResolvedValue(capabilities),
    pickLocalFile: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        descriptor: {
          schemaVersion: 1,
          kind: 'local',
          fingerprint: `sha256:${'a'.repeat(64)}`,
          title: 'Moonlight Cut',
          mimeType: 'video/mp4',
          size: 10 * 1024 * 1024,
        },
        localHandle: 'b'.repeat(32),
      },
    }),
    resolveLocalMatch: vi.fn(),
    getDriveConnection: vi.fn(),
    connectDrive: vi.fn(),
    cancelDriveConnect: vi.fn().mockResolvedValue(undefined),
    ensureDriveWorkspace: vi.fn(),
    openDriveWorkspace: vi.fn(),
    pickDriveFile: vi.fn(),
    disconnectDrive: vi.fn(),
    createPlaybackLease: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        leaseId: 'c'.repeat(32),
        playbackUrl: `nightwatch-media://stream/${'c'.repeat(32)}`,
        expiresAt: Date.now() + 60_000,
      },
    }),
    releasePlaybackLease: vi.fn().mockResolvedValue(undefined),
    onFingerprintProgress: vi.fn().mockReturnValue(() => {}),
    cancelFingerprint: vi.fn().mockResolvedValue(undefined),
  };
}

describe('LibraryScreen', () => {
  it('shows Drive setup status and privacy safeguards while the owner gate is off', () => {
    render(<LibraryScreen bridge={makeBridge()} capabilities={capabilities} />);

    expect(screen.getByRole('heading', { name: 'Google Drive' })).toBeTruthy();
    expect(screen.getByText('Drive disabled in this build')).toBeTruthy();
    expect(screen.getByText(/system browser/i)).toBeTruthy();
    expect(screen.getByText(/safeStorage/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect google drive/i })).toBeNull();
  });

  it('selects an authorized local file and creates an opaque playback lease', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    const bridge = makeBridge();
    const user = userEvent.setup();
    render(<LibraryScreen bridge={bridge} capabilities={capabilities} />);

    await user.click(screen.getByRole('button', { name: /choose local video/i }));

    expect(bridge.pickLocalFile).toHaveBeenCalledOnce();
    expect(bridge.createPlaybackLease).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'local', title: 'Moonlight Cut' }),
    );
    expect(screen.getByRole('heading', { name: 'Moonlight Cut' })).toBeTruthy();
    expect(document.querySelector('video')?.getAttribute('src')).toMatch(/^nightwatch-media:/);
  });

  it('releases the active lease when leaving the Library', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    const bridge = makeBridge();
    const user = userEvent.setup();
    const view = render(<LibraryScreen bridge={bridge} capabilities={capabilities} />);
    await user.click(screen.getByRole('button', { name: /choose local video/i }));

    view.unmount();

    expect(bridge.releasePlaybackLease).toHaveBeenCalledWith('c'.repeat(32));
  });
});
