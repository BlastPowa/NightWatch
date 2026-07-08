/**
 * Local settings store (ADR-009): theme, volume, and video filters live in
 * localStorage only — never synced to other members or any backend.
 */

export type ThemeId = 'electric-teal' | 'shiny-gold' | 'legacy';

export const THEMES: ReadonlyArray<{ id: ThemeId; label: string }> = [
  { id: 'electric-teal', label: 'Electric Teal' },
  { id: 'shiny-gold', label: 'Shiny Gold' },
  { id: 'legacy', label: 'Legacy' },
];

export interface VideoFilters {
  /** Percentages, 50–150. 100 = neutral. */
  brightness: number;
  contrast: number;
  saturation: number;
}

/** Accent palette (inspired by the NightPlay-style accent picker). */
export const ACCENT_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#2dd4bf',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export interface Settings {
  theme: ThemeId;
  accent: AccentColor;
  volumePercent: number;
  videoFilters: VideoFilters;
}

export const NEUTRAL_FILTERS: VideoFilters = { brightness: 100, contrast: 100, saturation: 100 };

export const DEFAULT_SETTINGS: Settings = {
  theme: 'electric-teal',
  accent: '#2dd4bf',
  volumePercent: 100,
  videoFilters: NEUTRAL_FILTERS,
};

const STORAGE_KEY = 'nightwatch:settings';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitize(raw: unknown): Settings {
  const partial = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;
  const filters = (partial.videoFilters ?? {}) as Partial<VideoFilters>;
  const theme = THEMES.some((t) => t.id === partial.theme)
    ? (partial.theme as ThemeId)
    : DEFAULT_SETTINGS.theme;
  const accent = (ACCENT_COLORS as readonly string[]).includes(partial.accent as string)
    ? (partial.accent as AccentColor)
    : DEFAULT_SETTINGS.accent;
  return {
    theme,
    accent,
    volumePercent: clamp(Number(partial.volumePercent ?? 100) || 100, 0, 100),
    videoFilters: {
      brightness: clamp(Number(filters.brightness ?? 100) || 100, 50, 150),
      contrast: clamp(Number(filters.contrast ?? 100) || 100, 50, 150),
      saturation: clamp(Number(filters.saturation ?? 100) || 100, 50, 150),
    },
  };
}

type SettingsListener = (settings: Settings) => void;

class SettingsStore {
  private settings: Settings;
  private readonly listeners = new Set<SettingsListener>();

  public constructor() {
    let raw: unknown = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      raw = stored === null ? null : (JSON.parse(stored) as unknown);
    } catch {
      raw = null;
    }
    this.settings = raw === null ? DEFAULT_SETTINGS : sanitize(raw);
  }

  public get(): Settings {
    return this.settings;
  }

  public update(partial: Partial<Omit<Settings, 'videoFilters'>> & { videoFilters?: Partial<VideoFilters> }): void {
    this.settings = sanitize({
      ...this.settings,
      ...partial,
      videoFilters: { ...this.settings.videoFilters, ...partial.videoFilters },
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    this.listeners.forEach((listener) => listener(this.settings));
  }

  public subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const settingsStore = new SettingsStore();
