import { afterEach, describe, expect, it, vi } from 'vitest';

function storageWith(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('settings custom atmosphere migration', () => {
  it('adds safe defaults to settings saved by an older client', async () => {
    vi.stubGlobal('localStorage', storageWith({
      'nightwatch:settings': JSON.stringify({ theme: 'alien-x', accent: '#0ba86b' }),
    }));
    const { settingsStore } = await import('@/lib/settings');
    expect(settingsStore.get().theme).toBe('alien-x');
    expect(settingsStore.get().customAtmosphere).toEqual({
      canvas: '#050507', surface: '#111217', panel: '#090a0e',
    });
  });

  it('persists a partial custom palette without dropping its other colours', async () => {
    vi.stubGlobal('localStorage', storageWith());
    const { settingsStore } = await import('@/lib/settings');
    settingsStore.update({ theme: 'custom', customAtmosphere: { canvas: '#010203' } });
    expect(settingsStore.get().customAtmosphere).toEqual({
      canvas: '#010203', surface: '#111217', panel: '#090a0e',
    });
  });
});
