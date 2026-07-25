import { describe, expect, it } from 'vitest';
import {
  buildDiagnostic,
  formatDiagnostic,
  newOperationId,
  normalizeFeature,
  outcomeFromError,
  sanitizeDiagnostic,
} from './safeDiagnostics';

const CONTEXT = { authenticated: true, online: true, schemaGeneration: 34 };

describe('normalizeFeature', () => {
  it('passes allowlisted names and coerces everything else', () => {
    expect(normalizeFeature('people.search')).toBe('people.search');
    // A call site cannot smuggle content into the feature field.
    expect(normalizeFeature('room ABCDEF joined')).toBe('unknown');
    expect(normalizeFeature('drive:1a2b3c4d5e')).toBe('unknown');
  });
});

describe('buildDiagnostic', () => {
  it('produces only the six contract fields', () => {
    const diagnostic = buildDiagnostic('messaging.send', 'success', CONTEXT);
    expect(Object.keys(diagnostic).sort()).toEqual([
      'authenticated',
      'feature',
      'online',
      'operationId',
      'outcome',
      'schemaGeneration',
    ]);
  });

  it('reuses a supplied operation id so stages correlate', () => {
    const id = newOperationId();
    expect(buildDiagnostic('auth.sign-in', 'success', CONTEXT, id).operationId).toBe(id);
  });

  it('operation ids are opaque hex, not derived from inputs', () => {
    expect(newOperationId()).toMatch(/^[0-9a-f]{16}$/);
    expect(newOperationId()).not.toBe(newOperationId());
  });
});

describe('formatDiagnostic', () => {
  it('emits a fixed-vocabulary line with no free text', () => {
    const line = formatDiagnostic(
      buildDiagnostic('people.search', 'rate-limited', CONTEXT, 'abcdef0123456789'),
    );
    expect(line).toBe(
      'op=abcdef0123456789 feature=people.search outcome=rate-limited auth=true online=true schema=34',
    );
  });

  it('renders an unknown schema generation without inventing one', () => {
    const line = formatDiagnostic(
      buildDiagnostic('capabilities.manifest', 'offline', {
        authenticated: false,
        online: false,
        schemaGeneration: null,
      }),
    );
    expect(line).toContain('schema=unknown');
  });
});

describe('outcomeFromError', () => {
  it('maps deployment, auth, permission, rate, conflict, and offline shapes', () => {
    expect(outcomeFromError({ code: '42883' })).toBe('deployment-missing');
    expect(outcomeFromError({ code: '42P01' })).toBe('deployment-missing');
    expect(outcomeFromError({ message: 'blocked' })).toBe('blocked');
    expect(outcomeFromError({ status: 429 })).toBe('rate-limited');
    expect(outcomeFromError({ message: 'unauthenticated' })).toBe('signed-out');
    expect(outcomeFromError({ status: 403 })).toBe('forbidden');
    expect(outcomeFromError({ message: 'revision conflict' })).toBe('conflict');
    expect(outcomeFromError({ message: 'Failed to fetch' })).toBe('offline');
    expect(outcomeFromError({ message: 'something odd' })).toBe('failed');
  });

  it('never returns provider text — only an enum member', () => {
    const outcome = outcomeFromError({
      message: 'duplicate key value violates unique constraint "secret_table_pkey"',
    });
    expect(outcome).toBe('failed');
  });
});

describe('sanitizeDiagnostic', () => {
  it('bounds the id, re-normalizes the feature, and nulls a bad generation', () => {
    const dirty = {
      operationId: 'f'.repeat(80),
      feature: 'totally-made-up',
      outcome: 'success' as const,
      authenticated: true,
      online: true,
      schemaGeneration: Number.NaN,
    };
    const clean = sanitizeDiagnostic(dirty);
    expect(clean.operationId).toHaveLength(32);
    expect(clean.feature).toBe('unknown');
    expect(clean.schemaGeneration).toBeNull();
  });
});
