// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const shareHarness = vi.hoisted(() => ({
  startViewing: vi.fn(async () => ({ ok: true as const, value: undefined })),
  startSharing: vi.fn(async () => ({ ok: true as const, value: undefined })),
  end: vi.fn(),
  registerShare: vi.fn(() => vi.fn()),
}));

const roomMediaHarness = vi.hoisted(() => ({
  getRoomMediaDescriptor: vi.fn(),
  publishRoomMediaDescriptor: vi.fn(),
}));

vi.mock('@/lib/media/roomMediaCapabilities', () => ({
  getRoomMediaCapabilities: vi.fn(async () => ({
    fileWatch: false,
    driveWorkspace: false,
    liveShare: true,
    voiceChat: true,
    publicUserSearch: false,
    roomPeopleActions: false,
  })),
  explainRoomMediaCapabilities: vi.fn(() => ({
    fileWatch: 'unsupported-platform',
    driveWorkspace: 'unsupported-platform',
    liveShare: 'available',
    voiceChat: 'available',
    publicUserSearch: 'signed-out',
    roomPeopleActions: 'signed-out',
  })),
  resetRoomMediaCapabilities: vi.fn(),
}));

vi.mock('@/lib/media/RoomMediaService', () => roomMediaHarness);
vi.mock('@/lib/rtc/CommsLifecycle', () => ({
  commsLifecycle: { registerShare: shareHarness.registerShare },
}));
vi.mock('@/lib/rtc/ShareSession', () => ({
  ShareSession: class {
    public static supported(): boolean { return true; }
    public constructor(_roomCode: string, _selfId: string, _events: unknown) {}
    public startViewing = shareHarness.startViewing;
    public startSharing = shareHarness.startSharing;
    public end = shareHarness.end;
    public getSessionId(): string { return 'a'.repeat(32); }
  },
}));

import { ScreenWatchPanel } from './ScreenWatchPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ScreenWatchPanel consent', () => {
  it('discovers an offered share without starting remote viewing until Join share is clicked', async () => {
    roomMediaHarness.getRoomMediaDescriptor.mockResolvedValue({
      ok: true,
      value: {
        revision: 7,
        controllerId: 'host',
        updatedAt: new Date().toISOString(),
        mode: {
          modeVersion: 2,
          mode: 'live-share',
          sessionId: 'b'.repeat(32),
          sharerId: 'host',
          sourceLabel: 'Browser tab',
        },
      },
    });

    const user = userEvent.setup();
    render(
      <ScreenWatchPanel
        roomCode="ABC234"
        selfId="viewer"
        isHost={false}
        active
        youtubeVideoId={null}
      />,
    );

    const join = await screen.findByRole('button', { name: 'Join share' });
    expect(shareHarness.startViewing).not.toHaveBeenCalled();

    await user.click(join);
    await waitFor(() => expect(shareHarness.startViewing).toHaveBeenCalledWith('host', 'b'.repeat(32)));
  });
});
