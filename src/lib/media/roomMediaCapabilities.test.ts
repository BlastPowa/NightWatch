import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
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
    mocks.getSession.mockReset();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it('keeps every capability off while signed out and performs no probes', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const result = await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    expect(Object.values(result).every((flag) => !flag)).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('combines deployed contracts, platform support, and TURN readiness', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mocks.rpc.mockResolvedValue({
      data: {
        schemaVersion: 1,
        peopleDiscovery: true,
        roomPeople: true,
        roomMedia: true,
        signaling: true,
      },
      error: null,
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
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an undeployed or malformed contract', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: {} } });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    mocks.invoke.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    const result = await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    expect(Object.values(result).every((flag) => !flag)).toBe(true);
  });
});
