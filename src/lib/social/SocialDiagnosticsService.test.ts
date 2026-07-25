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
const requiredFunctions = {
  get_social_graph: true,
  send_friend_request: true,
  search_people: true,
  get_room_people: true,
  list_conversations: true,
  get_messages: true,
  send_message: true,
  create_direct_conversation: true,
  create_group_conversation: true,
};
const manifest = {
  schemaGeneration: 34,
  authenticated: true,
  functions: requiredFunctions,
  realtimeTables: ['friend_requests', 'messages'],
};

beforeEach(() => {
  rpc.mockReset();
  getSession.mockReset();
});

describe('diagnoseSocial', () => {
  it('is ready when the session and exact manifest are ready', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: manifest, error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'ready' });
  });

  it('does not call the server when there is no NightWatch session', async () => {
    getSession.mockResolvedValue(signedOut);
    expect(await diagnoseSocial()).toEqual({ status: 'account-required' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('trusts the server when a stale local session is no longer authenticated', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: { ...manifest, authenticated: false }, error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'account-required' });
  });

  it('names missing required functions', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({
      data: {
        ...manifest,
        functions: { ...requiredFunctions, send_message: false, get_social_graph: false },
      },
      error: null,
    });
    expect(await diagnoseSocial()).toEqual({
      status: 'deployment-missing',
      missing: ['get_social_graph', 'send_message'],
    });
  });

  it('reports a completely missing manifest deployment', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: null, error: { message: 'missing', code: '42883' } });
    expect(await diagnoseSocial()).toEqual({
      status: 'deployment-missing',
      missing: ['runtime_capabilities_v2'],
    });
  });

  it('reports offline when the request never reaches Postgres', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch', code: '' } });
    expect(await diagnoseSocial()).toEqual({ status: 'offline' });
  });

  it('treats malformed manifest data as an error', async () => {
    getSession.mockResolvedValue(signedIn);
    rpc.mockResolvedValue({ data: 'garbage', error: null });
    expect(await diagnoseSocial()).toEqual({ status: 'error' });
  });
});
