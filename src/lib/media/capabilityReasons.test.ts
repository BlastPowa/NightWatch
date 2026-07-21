import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
const getSessionMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: { getSession: () => getSessionMock() },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

import {
  explainRoomMediaCapabilities,
  getRoomMediaCapabilities,
  resetRoomMediaCapabilities,
} from './roomMediaCapabilities';

const PLATFORM = { htmlMedia: true, googleDrive: false };

const SERVER_ALL = {
  schemaVersion: 1,
  peopleDiscovery: true,
  roomPeople: true,
  roomMedia: true,
  signaling: true,
};

beforeEach(() => {
  resetRoomMediaCapabilities();
  rpcMock.mockReset();
  getSessionMock.mockReset();
  invokeMock.mockReset();
});

describe('explainRoomMediaCapabilities', () => {
  it('reports signed-out for every flag before authentication', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await getRoomMediaCapabilities(PLATFORM);
    const reasons = explainRoomMediaCapabilities(PLATFORM);
    expect(Object.values(reasons).every((reason) => reason === 'signed-out')).toBe(true);
  });

  it('reports not-deployed when the capabilities RPC is missing', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    rpcMock.mockResolvedValue({ data: null, error: { code: '42883' } });
    invokeMock.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    await getRoomMediaCapabilities(PLATFORM);
    const reasons = explainRoomMediaCapabilities(PLATFORM);
    expect(reasons.publicUserSearch).toBe('not-deployed');
    expect(reasons.voiceChat).toBe('not-deployed');
  });

  it('distinguishes platform gaps from relay gaps once deployed', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    rpcMock.mockResolvedValue({ data: SERVER_ALL, error: null });
    // TURN function not configured/deployed:
    invokeMock.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    await getRoomMediaCapabilities(PLATFORM);
    const reasons = explainRoomMediaCapabilities(PLATFORM);
    expect(reasons.fileWatch).toBe('available');
    expect(reasons.driveWorkspace).toBe('unsupported-platform'); // googleDrive: false
    expect(reasons.voiceChat).toBe('relay-not-configured');
    expect(reasons.liveShare).toBe('relay-not-configured');
    expect(reasons.publicUserSearch).toBe('available');
    expect(reasons.roomPeopleActions).toBe('available');
  });

  it('reports available across the board when everything is deployed', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    rpcMock.mockResolvedValue({ data: SERVER_ALL, error: null });
    invokeMock.mockResolvedValue({ data: null, error: { context: { status: 403 } } });
    await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    const reasons = explainRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    expect(Object.values(reasons).every((reason) => reason === 'available')).toBe(true);
  });
});
