import { describe, expect, it, vi } from 'vitest';

// These tests exercise pure query/handle normalization. Keep the Supabase
// client boundary inert so CI does not require application credentials merely
// to import PeopleService.
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { HANDLE_PATTERN, normalizeSearchQuery, SEARCH_MIN_CHARS } from './PeopleService';

describe('normalizeSearchQuery', () => {
  it('trims, lowercases, and bounds length', () => {
    expect(normalizeSearchQuery('  ViewerVic  ')).toBe('viewervic');
    expect(normalizeSearchQuery('A'.repeat(100))).toHaveLength(40);
  });

  it('minimum length matches the server contract', () => {
    expect(SEARCH_MIN_CHARS).toBe(3);
    expect(normalizeSearchQuery('ab').length < SEARCH_MIN_CHARS).toBe(true);
  });
});

describe('HANDLE_PATTERN', () => {
  it('accepts the documented shape and rejects everything else', () => {
    expect(HANDLE_PATTERN.test('viewervic')).toBe(true);
    expect(HANDLE_PATTERN.test('a_1')).toBe(true);
    expect(HANDLE_PATTERN.test('ab')).toBe(false);
    expect(HANDLE_PATTERN.test('UPPER')).toBe(false);
    expect(HANDLE_PATTERN.test('has space')).toBe(false);
    expect(HANDLE_PATTERN.test('x'.repeat(21))).toBe(false);
  });
});
