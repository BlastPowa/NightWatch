import { describe, expect, it } from 'vitest';
import {
  emptyManifest,
  FEATURE_FUNCTION_REQUIREMENTS,
  hasFunctions,
  isFeatureReady,
  missingFunctions,
  parseRuntimeManifest,
} from './runtimeCapabilities';

const VALID = {
  schemaGeneration: 34,
  authenticated: true,
  functions: { search_people: true, set_discoverable: true, send_message: false },
  realtimeTables: ['messages', 'friend_requests'],
};

describe('parseRuntimeManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = parseRuntimeManifest(VALID);
    expect(manifest?.schemaGeneration).toBe(34);
    expect(manifest?.authenticated).toBe(true);
    expect(manifest?.realtimeTables).toEqual(['messages', 'friend_requests']);
  });

  it('rejects malformed payloads outright rather than half-trusting them', () => {
    expect(parseRuntimeManifest(null)).toBeNull();
    expect(parseRuntimeManifest([])).toBeNull();
    expect(parseRuntimeManifest({ ...VALID, schemaGeneration: 'x' })).toBeNull();
    expect(parseRuntimeManifest({ ...VALID, authenticated: 'yes' })).toBeNull();
    expect(parseRuntimeManifest({ ...VALID, functions: [] })).toBeNull();
    expect(parseRuntimeManifest({ ...VALID, realtimeTables: {} })).toBeNull();
  });

  it('drops non-boolean function flags and non-string tables', () => {
    const manifest = parseRuntimeManifest({
      ...VALID,
      functions: { good: true, bad: 'true' },
      realtimeTables: ['messages', 42],
    });
    expect(manifest?.functions).toEqual({ good: true });
    expect(manifest?.realtimeTables).toEqual(['messages']);
  });
});

describe('feature readiness', () => {
  it('treats a missing key as not deployed', () => {
    const manifest = parseRuntimeManifest(VALID)!;
    expect(hasFunctions(manifest, ['search_people'])).toBe(true);
    expect(hasFunctions(manifest, ['search_people', 'never_deployed'])).toBe(false);
    expect(missingFunctions(manifest, ['search_people', 'send_message'])).toEqual([
      'send_message',
    ]);
  });

  it('requires BOTH authentication and a complete function set', () => {
    const complete = {
      schemaGeneration: 34,
      authenticated: true,
      functions: Object.fromEntries(
        FEATURE_FUNCTION_REQUIREMENTS.peopleSearch.map((name) => [name, true]),
      ),
      realtimeTables: [],
    };
    expect(isFeatureReady(parseRuntimeManifest(complete)!, 'peopleSearch')).toBe(true);

    const signedOut = parseRuntimeManifest({ ...complete, authenticated: false })!;
    expect(isFeatureReady(signedOut, 'peopleSearch')).toBe(false);

    const partial = parseRuntimeManifest({
      ...complete,
      functions: { search_people: true },
    })!;
    expect(isFeatureReady(partial, 'peopleSearch')).toBe(false);
  });

  it('the empty manifest grants nothing', () => {
    const manifest = emptyManifest();
    for (const feature of Object.keys(FEATURE_FUNCTION_REQUIREMENTS)) {
      expect(isFeatureReady(manifest, feature as keyof typeof FEATURE_FUNCTION_REQUIREMENTS)).toBe(
        false,
      );
    }
  });
});
