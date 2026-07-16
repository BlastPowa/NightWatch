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
    expect(settingsStore.get()).toMatchObject({
      hoverPreviewEnabled: true,
      miniPlayerEnabled: true,
      captionMode: 'youtube-default',
      captionLanguage: 'auto',
      captionFontSize: 0,
      uiFont: 'system',
      cardStyle: 'glass',
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

  it('keeps valid browsing, caption, font, and atmosphere preferences', async () => {
    vi.stubGlobal('localStorage', storageWith({
      'nightwatch:settings': JSON.stringify({
        theme: 'neon-night',
        hoverPreviewEnabled: false,
        miniPlayerEnabled: false,
        captionMode: 'always-on',
        captionLanguage: 'ja',
        captionFontSize: 3,
        uiFont: 'cinematic',
        backgroundStyle: 'nebula',
        cardStyle: 'outline',
      }),
    }));
    const { settingsStore } = await import('@/lib/settings');
    expect(settingsStore.get()).toMatchObject({
      theme: 'neon-night',
      hoverPreviewEnabled: false,
      miniPlayerEnabled: false,
      captionMode: 'always-on',
      captionLanguage: 'ja',
      captionFontSize: 3,
      uiFont: 'cinematic',
      backgroundStyle: 'nebula',
      cardStyle: 'outline',
    });
  });

  it('sanitizes invalid browsing, caption, font, and atmosphere preferences', async () => {
    vi.stubGlobal('localStorage', storageWith({
      'nightwatch:settings': JSON.stringify({
        theme: 'ultraviolet',
        hoverPreviewEnabled: 'yes',
        miniPlayerEnabled: 1,
        captionMode: 'scraped',
        captionLanguage: 'xx',
        captionFontSize: 99,
        uiFont: 'streaming-brand',
        backgroundStyle: 'rainbow',
        cardStyle: 'floating',
      }),
    }));
    const { DEFAULT_SETTINGS, settingsStore } = await import('@/lib/settings');
    expect(settingsStore.get()).toMatchObject({
      theme: DEFAULT_SETTINGS.theme,
      hoverPreviewEnabled: true,
      miniPlayerEnabled: true,
      captionMode: 'youtube-default',
      captionLanguage: 'auto',
      captionFontSize: 0,
      uiFont: 'system',
      backgroundStyle: DEFAULT_SETTINGS.backgroundStyle,
      cardStyle: DEFAULT_SETTINGS.cardStyle,
    });
  });
});
