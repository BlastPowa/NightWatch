import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const getSession = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
  },
}));

import { diagnoseSocial } from '@/lib/social/SocialDiagnosticsService';

const signedIn = { data: { session: { user: { id: 'u-1' } } } };
const signedOut = { data: { session: null } };

const allDeployed = {
  version: 1,
  hasSession: true,
  functions: {
    get_social_graph: true,
    send_message: true,
    heartbeat_live_room_social: true,
  },
  realtimeTables: ['friend_requests', 'messages'],
};

beforeEach(() => {
  rpc.mockReset();
  getSession.mockReset();
});

describe('diagnoseSocial', () => {
  it('is ready when signed in and fully deployed', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: allDeployed, error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'ready' });
  });

  it('requires an account when there is no NightWatch session', async () => {
    getSession.mockResolvedValue(signedOut);
    rpc.mockResolvedValue({ data: { ...allDeployed, hasSession: false }, error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'account-required' });
  });

  it('trusts the server over a stale local session', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: { ...allDeployed, hasSession: false }, error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'account-required' });
  });

  it('names missing functions when a migration was skipped', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({
      data: {
        ...allDeployed,
        functions: { ...allDeployed.functions, send_message: false, get_social_graph: false },
      },
      error: null,
    });
    expect(await diagnoseSocial()).toEqual({
      status: 'deployment-missing',
      missing: ['get_social_graph', 'send_message'],
    });
  });

  it('reports the diagnostics RPC itself missing on 42883', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function does not exist', code: '42883', details: null, hint: null },
    });
    expect(await diagnoseSocial()).toEqual({
      status: 'deployment-missing',
      missing: ['social_diagnostics'],
    });
  });

  it('reports offline when the request never reached Postgres', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch', code: '', details: null, hint: null },
    });
    expect(await diagnoseSocial()).toEqual({ status: 'offline' });
  });

  it('treats a malformed payload as an error, never as ready', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: 'garbage', error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'error' });
  });
});
