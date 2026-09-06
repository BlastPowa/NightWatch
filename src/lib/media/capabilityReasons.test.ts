import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FUNCTION_REQUIREMENTS } from '@shared/runtimeCapabilities';
import { runtimeCapabilities } from '@/lib/platform/RuntimeCapabilityService';

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

const ALL_FUNCTIONS = Object.fromEntries(
  Object.values(FEATURE_FUNCTION_REQUIREMENTS).flat().map((name) => [name, true]),
);

function manifest(
  authenticated: boolean,
  functions: Record<string, boolean> = {},
) {
  return {
    schemaGeneration: 2,
    authenticated,
    functions,
    realtimeTables: [],
  };
}

beforeEach(() => {
  resetRoomMediaCapabilities();
  runtimeCapabilities.reset();
  rpcMock.mockReset();
  getSessionMock.mockReset();
  // The singleton capability service waits for this promise before it asks
  // Supabase for the server manifest. Every scenario must settle it.
  getSessionMock.mockResolvedValue({ data: { session: null } });
  invokeMock.mockReset();
});

describe('explainRoomMediaCapabilities', () => {
  it('reports signed-out for every flag before authentication', async () => {
    rpcMock.mockResolvedValue({ data: manifest(false), error: null });
    await getRoomMediaCapabilities(PLATFORM);
    const reasons = explainRoomMediaCapabilities(PLATFORM);
    expect(Object.values(reasons).every((reason) => reason === 'signed-out')).toBe(true);
  });

  it('reports not-deployed when the capabilities RPC is missing', async () => {
    rpcMock.mockImplementation((functionName: string) => (
      functionName === 'runtime_capabilities_v2'
        ? Promise.resolve({ data: null, error: { code: '42883' } })
        : Promise.resolve({ data: { hasSession: true, functions: {}, realtimeTables: [] }, error: null })
    ));
    invokeMock.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    await getRoomMediaCapabilities(PLATFORM);
    const reasons = explainRoomMediaCapabilities(PLATFORM);
    expect(reasons.publicUserSearch).toBe('not-deployed');
    expect(reasons.voiceChat).toBe('not-deployed');
  });

  it('distinguishes platform gaps from relay gaps once deployed', async () => {
    rpcMock.mockResolvedValue({ data: manifest(true, ALL_FUNCTIONS), error: null });
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
    rpcMock.mockResolvedValue({ data: manifest(true, ALL_FUNCTIONS), error: null });
    invokeMock.mockResolvedValue({ data: null, error: { context: { status: 403 } } });
    await getRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    const reasons = explainRoomMediaCapabilities({ htmlMedia: true, googleDrive: true });
    expect(Object.values(reasons).every((reason) => reason === 'available')).toBe(true);
  });
});
