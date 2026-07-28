// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaPlatformBridge } from '@shared/mediaBridge';
import type { RoomService } from '@/lib/room/RoomService';

const mocks = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getDescriptor: vi.fn(),
  publish: vi.fn(),
  report: vi.fn(),
  roster: vi.fn(),
}));

vi.mock('@/lib/media/roomMediaCapabilities', () => ({
  getRoomMediaCapabilities: mocks.getCapabilities,
}));
vi.mock('@/lib/media/RoomMediaService', () => ({
  getRoomMediaDescriptor: mocks.getDescriptor,
  publishRoomMediaDescriptor: mocks.publish,
  reportMediaReadiness: mocks.report,
  getMediaReadinessRoster: mocks.roster,
}));

import { MovieWatchPanel } from '@/components/MovieWatchPanel';

afterEach(cleanup);

const source = {
  schemaVersion: 1 as const,
  kind: 'local' as const,
  fingerprint: `sha256:${'a'.repeat(64)}` as const,
  title: 'Movie night.mp4',
  mimeType: 'video/mp4' as const,
  size: 1024,
};

function service(): RoomService {
  return {
    selfId: 'host',
    on: vi.fn(() => vi.fn()),
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as RoomService;
}

function bridge(): MediaPlatformBridge {
  return {
    pickLocalFile: vi.fn().mockResolvedValue({ ok: true, value: { descriptor: source, localHandle: 'a'.repeat(32) } }),
    pickDriveFile: vi.fn(),
    createPlaybackLease: vi.fn().mockResolvedValue({ ok: true, value: { leaseId: 'b'.repeat(32), playbackUrl: `nightwatch-media://stream/${'b'.repeat(32)}`, expiresAt: Date.now() + 60_000 } }),
    releasePlaybackLease: vi.fn().mockResolvedValue(undefined),
    resolveLocalMatch: vi.fn(),
  } as unknown as MediaPlatformBridge;
}

describe('MovieWatchPanel', () => {
  it('only presents real desktop media choices after the deployed capability is ready', async () => {
    mocks.getCapabilities.mockResolvedValue({ fileWatch: true });
    mocks.getDescriptor.mockResolvedValue({ ok: true, value: null });
    mocks.roster.mockResolvedValue({ ok: true, value: [] });

    render(<MovieWatchPanel roomCode="ABC234" service={service()} selfId="host" hostId="host" isHost bridge={bridge()} htmlMediaAvailable active onModeChange={vi.fn()} onHasMediaChange={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Movie Watch' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /choose local video/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /choose drive video/i })).toBeTruthy();
  });

  it('publishes only a versioned descriptor and broadcasts a media load after a host selects a file', async () => {
    const user = userEvent.setup();
    const roomService = service();
    const mediaBridge = bridge();
    mocks.getCapabilities.mockResolvedValue({ fileWatch: true });
    mocks.getDescriptor.mockResolvedValue({ ok: true, value: null });
    mocks.publish.mockResolvedValue({ ok: true, value: { revision: 1, controllerId: 'host', mode: { modeVersion: 2, mode: 'file-watch', descriptor: source, readiness: 'all-ready' }, updatedAt: null } });
    mocks.report.mockResolvedValue({ ok: true, value: undefined });
    mocks.roster.mockResolvedValue({ ok: true, value: [] });

    render(<MovieWatchPanel roomCode="ABC234" service={roomService} selfId="host" hostId="host" isHost bridge={mediaBridge} htmlMediaAvailable active onModeChange={vi.fn()} onHasMediaChange={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /choose local video/i }));

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith('ABC234', null, expect.objectContaining({ modeVersion: 2, mode: 'file-watch', descriptor: source })));
    expect(roomService.send).toHaveBeenCalledWith('media:v1:load', expect.objectContaining({ source, revision: 1 }));
    expect(mediaBridge.createPlaybackLease).toHaveBeenCalledWith(source);
  });
});
