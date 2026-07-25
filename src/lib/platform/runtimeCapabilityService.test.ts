import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const logMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      getSession: () => getSessionMock(),
      onAuthStateChange: (cb: unknown) => onAuthStateChangeMock(cb),
    },
  },
}));

vi.mock('@/lib/log', () => ({ log: (...args: unknown[]) => logMock(...args) }));

import { runtimeCapabilities, reportOperation } from './RuntimeCapabilityService';

const MANIFEST = {
  schemaGeneration: 34,
  authenticated: true,
  functions: { search_people: true },
  realtimeTables: ['messages'],
};

beforeEach(() => {
  rpcMock.mockReset();
  getSessionMock.mockReset();
  onAuthStateChangeMock.mockReset();
  logMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  onAuthStateChangeMock.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  runtimeCapabilities.reset();
});

describe('RuntimeCapabilityService', () => {
  it('starts with a manifest that grants nothing', () => {
    const manifest = runtimeCapabilities.get();
    expect(manifest.authenticated).toBe(false);
    expect(manifest.functions).toEqual({});
    expect(manifest.schemaGeneration).toBe(0);
  });

  it('publishes a parsed manifest to subscribers', async () => {
    rpcMock.mockResolvedValue({ data: MANIFEST, error: null });
    const seen: boolean[] = [];
    const unsubscribe = runtimeCapabilities.subscribe((m) => seen.push(m.authenticated));

    await runtimeCapabilities.refresh('capabilities.manifest', true);

    expect(runtimeCapabilities.get().authenticated).toBe(true);
    expect(runtimeCapabilities.get().schemaGeneration).toBe(34);
    expect(seen).toContain(true);
    unsubscribe();
  });

  it('falls back to social_diagnostics when the manifest RPC is absent', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'runtime_capabilities_v2') {
        return Promise.resolve({ data: null, error: { code: '42883' } });
      }
      return Promise.resolve({
        data: { version: 1, hasSession: true, functions: { get_social_graph: true }, realtimeTables: ['messages'] },
        error: null,
      });
    });

    const manifest = await runtimeCapabilities.refresh('capabilities.manifest', true);

    // Old deployments still report the signed-in fact rather than failing shut.
    expect(manifest.authenticated).toBe(true);
    expect(manifest.functions['get_social_graph']).toBe(true);
    // schemaGeneration 0 marks a legacy answer.
    expect(manifest.schemaGeneration).toBe(0);
  });

  it('fails closed on a malformed manifest', async () => {
    rpcMock.mockResolvedValue({ data: { schemaGeneration: 'nope' }, error: null });
    const manifest = await runtimeCapabilities.refresh('capabilities.manifest', true);
    expect(manifest.authenticated).toBe(false);
    expect(manifest.functions).toEqual({});
  });

  it('fails closed and records offline when the transport throws', async () => {
    rpcMock.mockRejectedValue(new Error('network down'));
    const manifest = await runtimeCapabilities.refresh('capabilities.manifest', true);
    expect(manifest.authenticated).toBe(false);
    const lines = logMock.mock.calls.map((call) => String(call[1]));
    expect(lines.some((line) => line.includes('outcome=offline'))).toBe(true);
  });

  it('emits diagnostics that never contain provider text', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST301', message: 'row "secret-room-ABCDEF" violates policy' },
    });
    const received: string[] = [];
    const unsubscribe = runtimeCapabilities.onDiagnostic((d) => received.push(d.feature));

    await runtimeCapabilities.refresh('capabilities.manifest', true);

    const logged = logMock.mock.calls.map((call) => String(call[1])).join('\n');
    expect(logged).not.toContain('ABCDEF');
    expect(logged).not.toContain('secret-room');
    expect(received.length).toBeGreaterThan(0);
    unsubscribe();
  });

  it('deduplicates concurrent refreshes into one request', async () => {
    rpcMock.mockResolvedValue({ data: MANIFEST, error: null });
    await Promise.all([
      runtimeCapabilities.refresh('capabilities.manifest', true),
      runtimeCapabilities.refresh('capabilities.manifest', true),
      runtimeCapabilities.refresh('capabilities.manifest', true),
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('reset clears the cached manifest', async () => {
    rpcMock.mockResolvedValue({ data: MANIFEST, error: null });
    await runtimeCapabilities.refresh('capabilities.manifest', true);
    expect(runtimeCapabilities.get().authenticated).toBe(true);
    runtimeCapabilities.reset();
    expect(runtimeCapabilities.get().authenticated).toBe(false);
  });
});

describe('reportOperation', () => {
  it('attaches manifest context and logs one safe line', async () => {
    rpcMock.mockResolvedValue({ data: MANIFEST, error: null });
    await runtimeCapabilities.refresh('capabilities.manifest', true);
    logMock.mockClear();

    const diagnostic = reportOperation('people.search', 'rate-limited');

    expect(diagnostic.feature).toBe('people.search');
    expect(diagnostic.authenticated).toBe(true);
    expect(diagnostic.schemaGeneration).toBe(34);
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(String(logMock.mock.calls[0]?.[1])).toContain('outcome=rate-limited');
  });

  it('normalizes an unknown feature instead of logging it', () => {
    const diagnostic = reportOperation('room ABCDEF secret', 'failed');
    expect(diagnostic.feature).toBe('unknown');
    expect(String(logMock.mock.calls.at(-1)?.[1])).not.toContain('ABCDEF');
  });
});
