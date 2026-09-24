// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const voiceHarness = vi.hoisted(() => ({
  start: vi.fn(async () => ({ ok: true as const, value: undefined })),
  connectTo: vi.fn(async () => {}),
  end: vi.fn(),
  registerVoice: vi.fn(() => vi.fn()),
  events: null as any,
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
vi.mock('@/lib/rtc/CommsLifecycle', () => ({
  commsLifecycle: { registerVoice: voiceHarness.registerVoice },
}));
vi.mock('@/lib/rtc/VoiceSession', () => ({
  VoiceSession: class {
    public static supported(): boolean { return true; }
    public constructor(_roomCode: string, _selfId: string, events: any) {
      voiceHarness.events = events;
    }
    public async start(): Promise<{ ok: true; value: undefined }> {
      voiceHarness.events.onSnapshot({
        phase: 'connected',
        self: { muted: false, deafened: false, speaking: false },
        peers: [],
        endReason: null,
      });
      voiceHarness.events.onCapability({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceLabel: 'Test microphone',
      });
      return voiceHarness.start();
    }
    public connectTo = voiceHarness.connectTo;
    public end = voiceHarness.end;
    public setMuted(): void {}
    public setDeafened(): void {}
  },
}));

import { VoicePanel } from './VoicePanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  voiceHarness.events = null;
});

describe('VoicePanel', () => {
  it('joins voice, connects to the room roster, and leaves cleanly', async () => {
    const user = userEvent.setup();
    render(
      <VoicePanel
        roomCode="ABC234"
        selfId="self"
        members={[
          { id: 'self', displayName: 'Me', joinedAt: 1, isHost: true, streakDays: 0, avatarUrl: null },
          { id: 'friend', displayName: 'Friend', joinedAt: 2, isHost: false, streakDays: 0, avatarUrl: null },
        ]}
      />,
    );

    const join = await screen.findByRole('button', { name: 'Join voice' });
    await user.click(join);

    await waitFor(() => expect(voiceHarness.start).toHaveBeenCalledOnce());
    await waitFor(() => expect(voiceHarness.connectTo).toHaveBeenCalledWith('friend'));
    expect(await screen.findByText(/Test microphone/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(voiceHarness.end).toHaveBeenCalledWith('left');
  });

  it('can be joined again after an external lifecycle teardown ends the session', async () => {
    const user = userEvent.setup();
    render(
      <VoicePanel
        roomCode="ABC234"
        selfId="self"
        members={[{ id: 'self', displayName: 'Me', joinedAt: 1, isHost: true, streakDays: 0, avatarUrl: null }]}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Join voice' }));
    await waitFor(() => expect(voiceHarness.start).toHaveBeenCalledTimes(1));

    voiceHarness.events.onSnapshot({
      phase: 'ended',
      self: { muted: false, deafened: false, speaking: false },
      peers: [],
      endReason: 'signed-out',
    });

    await user.click(await screen.findByRole('button', { name: 'Join voice' }));
    await waitFor(() => expect(voiceHarness.start).toHaveBeenCalledTimes(2));
  });
});
