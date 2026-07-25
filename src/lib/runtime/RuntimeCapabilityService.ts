import {
  parseRuntimeManifest,
  type RuntimeCapabilityManifestV2,
} from '@shared/runtimeCapabilities';
import { supabase } from '@/lib/supabase';

export type { RuntimeCapabilityManifestV2 } from '@shared/runtimeCapabilities';

export type RuntimeCapabilityResult =
  | {
      status: 'ok';
      source: 'v2' | 'legacy';
      data: RuntimeCapabilityManifestV2;
    }
  | { status: 'deployment-missing' }
  | { status: 'offline' }
  | { status: 'error' };

let latestManifest: RuntimeCapabilityManifestV2 | null = null;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function functions(value: unknown): Record<string, boolean> | null {
  const record = object(value);
  if (record === null) return null;
  return Object.fromEntries(
    Object.entries(record).map(([name, available]) => [name, available === true]),
  );
}

function tableNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))].sort();
}

function parseV2(value: unknown): RuntimeCapabilityManifestV2 | null {
  const record = object(value);
  if (record === null) return null;
  const availableFunctions = functions(record['functions']);
  if (availableFunctions === null) return null;
  const generation = Number(record['schemaGeneration'] ?? record['schema_generation']);
  if (!Number.isSafeInteger(generation) || generation < 1) return null;
  return parseRuntimeManifest({
    schemaGeneration: generation,
    authenticated: record['authenticated'] === true,
    functions: availableFunctions,
    realtimeTables: tableNames(record['realtimeTables'] ?? record['realtime_tables']),
  });
}

function parseLegacy(value: unknown): RuntimeCapabilityManifestV2 | null {
  const record = object(value);
  if (record === null) return null;
  const availableFunctions = functions(record['functions']);
  if (availableFunctions === null) return null;
  return {
    schemaGeneration: 1,
    authenticated: record['hasSession'] === true || record['has_session'] === true,
    functions: availableFunctions,
    realtimeTables: tableNames(record['realtimeTables'] ?? record['realtime_tables']),
  };
}

function resultFromError(error: { code?: string | null; message?: string | null }): Exclude<RuntimeCapabilityResult, { status: 'ok' }> {
  if (error.code === '42883' || error.code === '42P01') {
    return { status: 'deployment-missing' };
  }
  const message = (error.message ?? '').toLowerCase();
  if (error.code === '' || error.code === undefined || message.includes('fetch') || message.includes('network')) {
    return { status: 'offline' };
  }
  return { status: 'error' };
}

/** Loads one read-only manifest instead of executing feature RPCs as probes. */
export async function getRuntimeCapabilityManifest(): Promise<RuntimeCapabilityResult> {
  const { data, error } = await supabase.rpc('runtime_capabilities_v2');
  if (error === null) {
    const parsed = parseV2(data);
    if (parsed !== null) latestManifest = parsed;
    return parsed === null ? { status: 'error' } : { status: 'ok', source: 'v2', data: parsed };
  }
  if (error.code !== '42883' && error.code !== '42P01') {
    return resultFromError(error);
  }

  const legacy = await supabase.rpc('social_diagnostics');
  if (legacy.error !== null) return resultFromError(legacy.error);
  const parsed = parseLegacy(legacy.data);
  if (parsed !== null) latestManifest = parsed;
  return parsed === null
    ? { status: 'error' }
    : { status: 'ok', source: 'legacy', data: parsed };
}

export function getCachedRuntimeCapabilityManifest(): RuntimeCapabilityManifestV2 | null {
  return latestManifest;
}
