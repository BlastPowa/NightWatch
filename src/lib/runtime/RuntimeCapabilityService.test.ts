import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { getRuntimeCapabilityManifest } from '@/lib/runtime/RuntimeCapabilityService';

beforeEach(() => rpc.mockReset());

describe('RuntimeCapabilityService', () => {
  it('parses the Phase 34 manifest without probing feature RPCs', async () => {
    rpc.mockResolvedValue({
      data: {
        schema_generation: 34,
        authenticated: true,
        functions: { send_message: true, search_people: false },
        realtime_tables: ['messages', 'friend_requests', 'messages'],
      },
      error: null,
    });
    expect(await getRuntimeCapabilityManifest()).toEqual({
      status: 'ok',
      source: 'v2',
      data: {
        schemaGeneration: 34,
        authenticated: true,
        functions: { send_message: true, search_people: false },
        realtimeTables: ['friend_requests', 'messages'],
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('runtime_capabilities_v2');
  });

  it('falls back to the read-only v0.1.27 diagnostic during deployment', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'missing' } })
      .mockResolvedValueOnce({
        data: { hasSession: true, functions: { get_social_graph: true } },
        error: null,
      });
    const result = await getRuntimeCapabilityManifest();
    expect(result).toMatchObject({
      status: 'ok',
      source: 'legacy',
      data: { schemaGeneration: 1, authenticated: true },
    });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'runtime_capabilities_v2',
      'social_diagnostics',
    ]);
  });

  it('reports network failure without executing a fallback probe', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'Failed to fetch' } });
    expect(await getRuntimeCapabilityManifest()).toEqual({ status: 'offline' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
