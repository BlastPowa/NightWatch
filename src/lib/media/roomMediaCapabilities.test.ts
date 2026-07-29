import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  whenSessionSettled: vi.fn(),
  refresh: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock('@/lib/platform/RuntimeCapabilityService', () => ({
  runtimeCapabilities: {
    whenSessionSettled: mocks.whenSessionSettled,
    refresh: mocks.refresh,
    subscribe: mocks.subscribe,
  },
}));

import {
  getRoomMediaCapabilities,
  isTurnDeployed,
  resetRoomMediaCapabilities,
} from './roomMediaCapabilities';

describe('room media capability detection', () => {
  beforeEach(() => {
    resetRoomMediaCapabilities();
    mocks.invoke.mockReset();
    mocks.whenSessionSettled.mockReset();
    mocks.whenSessionSettled.mockResolvedValue(undefined);
    mocks.refresh.mockReset();
  });

  it('keeps every capability off while the session-aware manifest is signed out and performs no probes', async () => {
    mocks.refresh.mockResolvedValue({ schemaGeneration: 2, authenticated: false, functions: {}, realtimeTables: [] });
    const result = await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    expect(Object.values(result).every((flag) => !flag)).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('combines the deployed manifest, platform support, and TURN readiness', async () => {
    mocks.refresh.mockResolvedValue({
      schemaGeneration: 2,
      authenticated: true,
      functions: {
        search_people: true,
        set_discoverable: true,
        get_room_people: true,
        heartbeat_live_room_social: true,
        publish_room_media_descriptor: true,
        get_room_media_descriptor: true,
        report_media_readiness: true,
        get_media_readiness_roster: true,
        send_rtc_signal: true,
        fetch_rtc_signals: true,
      },
      realtimeTables: [],
    });
    mocks.invoke.mockResolvedValue({
      data: null,
      error: { context: { status: 403 } },
    });
    const result = await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: false });
    expect(result).toEqual({
      fileWatch: true,
      driveWorkspace: false,
      liveShare: true,
      voiceChat: true,
      publicUserSearch: true,
      roomPeopleActions: true,
    });
    expect(isTurnDeployed()).toBe(true);
    expect(mocks.whenSessionSettled).toHaveBeenCalledTimes(1);
  });

  it('fails closed for a manifest without room-media contracts', async () => {
    mocks.refresh.mockResolvedValue({ schemaGeneration: 2, authenticated: true, functions: {}, realtimeTables: [] });
    const result = await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    expect(Object.values(result).every((flag) => !flag)).toBe(true);
  });
});
