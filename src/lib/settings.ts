/**
 * Local settings store (ADR-009): theme, volume, and video filters live in
 * localStorage only — never synced to other members or any backend.
 */

export type ThemeId =
  | 'electric-teal'
  | 'shiny-gold'
  | 'legacy'
  | 'moonlit-violet'
  | 'crimson-theatre'
  | 'oceanic'
  | 'evergreen'
  | 'rose-noir'
  | 'doomsday'
  | 'brand-new-day'
  | 'alien-x'
  | 'obsidian'
  | 'obsidian-red'
  | 'obsidian-blue'
  | 'ember-noir'
  | 'arctic-light'
  | 'solar-flare'
  | 'neon-night'
  | 'custom';

export const THEMES: ReadonlyArray<{ id: ThemeId; label: string }> = [
  { id: 'electric-teal', label: 'Electric Teal' },
  { id: 'shiny-gold', label: 'Shiny Gold' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'moonlit-violet', label: 'Moonlit Violet' },
  { id: 'crimson-theatre', label: 'Crimson Theatre' },
  { id: 'oceanic', label: 'Oceanic' },
  { id: 'evergreen', label: 'Evergreen' },
  { id: 'rose-noir', label: 'Rose Noir' },
  { id: 'doomsday', label: 'Avengers: Doomsday' },
  { id: 'brand-new-day', label: 'Spider-Man: Brand New Day' },
  { id: 'alien-x', label: 'Alien X' },
  { id: 'obsidian', label: 'Obsidian Black' },
  { id: 'obsidian-red', label: 'Obsidian Red' },
  { id: 'obsidian-blue', label: 'Obsidian Blue' },
  { id: 'ember-noir', label: 'Ember Noir' },
  { id: 'arctic-light', label: 'Arctic Light' },
  { id: 'solar-flare', label: 'Solar Flare' },
  { id: 'neon-night', label: 'Neon Night' },
  { id: 'custom', label: 'Custom Atmosphere' },
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

export type AccentColor = string;
export type UiDensity = 'compact' | 'comfortable' | 'spacious';
export type BackgroundStyle =
  | 'midnight'
  | 'aurora'
  | 'studio'
  | 'nebula'
  | 'ember'
  | 'frost'
  | 'cinema';
export type CardStyle = 'glass' | 'solid' | 'soft' | 'outline';
export type CaptionMode = 'youtube-default' | 'always-on';
export type CaptionLanguage = 'auto' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ja' | 'ko';
export type CaptionFontSize = -1 | 0 | 1 | 2 | 3;
export type UiFont = 'system' | 'cinematic' | 'editorial' | 'modern' | 'classic' | 'comic' | 'mono';
export interface CustomAtmosphere { canvas: string; surface: string; panel: string; }

export interface Settings {
  theme: ThemeId;
  accent: AccentColor;
  volumePercent: number;
  videoFilters: VideoFilters;
  /** Censor profanity in messages YOU send (English wordlist). */
  chatFilterEnabled: boolean;
  /** Show what you're watching as Discord Rich Presence. */
  richPresenceEnabled: boolean;
  accentGlowPercent: number;
  cornerRadiusPx: number;
  density: UiDensity;
  backgroundStyle: BackgroundStyle;
  cardStyle: CardStyle;
  customAtmosphere: CustomAtmosphere;
  reduceMotion: boolean;
  highContrast: boolean;
  textScalePercent: number;
  reduceTransparency: boolean;
  enhancedFocus: boolean;
  /** Enable muted official YouTube previews after a short desktop hover. */
  hoverPreviewEnabled: boolean;
  /** Keep the synchronized room player visible while visiting other screens. */
  miniPlayerEnabled: boolean;
  /** Request captions supplied by YouTube when the player initializes. */
  captionMode: CaptionMode;
  captionLanguage: CaptionLanguage;
  captionFontSize: CaptionFontSize;
  uiFont: UiFont;
  /** Resized device-local image used only when the matching presentation flag is enabled. */
  customBackgroundImage: string | null;
  customBackgroundEnabled: boolean;
  profileBackgroundEnabled: boolean;
}

export const NEUTRAL_FILTERS: VideoFilters = { brightness: 100, contrast: 100, saturation: 100 };

export const DEFAULT_SETTINGS: Settings = {
  theme: 'electric-teal',
  accent: '#2dd4bf',
  volumePercent: 100,
  videoFilters: NEUTRAL_FILTERS,
  chatFilterEnabled: true,
  richPresenceEnabled: true,
  accentGlowPercent: 55,
  cornerRadiusPx: 16,
  density: 'comfortable',
  backgroundStyle: 'midnight',
  cardStyle: 'glass',
  customAtmosphere: { canvas: '#050507', surface: '#111217', panel: '#090a0e' },
  reduceMotion: false,
  highContrast: false,
  textScalePercent: 100,
  reduceTransparency: false,
  enhancedFocus: true,
  hoverPreviewEnabled: true,
  miniPlayerEnabled: true,
  captionMode: 'youtube-default',
  captionLanguage: 'auto',
  captionFontSize: 0,
  uiFont: 'system',
  customBackgroundImage: null,
  customBackgroundEnabled: false,
  profileBackgroundEnabled: false,
};

const STORAGE_KEY = 'nightwatch:settings';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

function safeBackgroundImage(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 3_000_000 ||
    !/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value)
  ) {
    return null;
  }
  return value;
}

function sanitize(raw: unknown): Settings {
  const partial = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;
  const filters = (partial.videoFilters ?? {}) as Partial<VideoFilters>;
  const customAtmosphere = (partial.customAtmosphere ?? {}) as Partial<CustomAtmosphere>;
  const theme = THEMES.some((t) => t.id === partial.theme)
    ? (partial.theme as ThemeId)
    : DEFAULT_SETTINGS.theme;
  const accent =
    typeof partial.accent === 'string' && /^#[0-9a-f]{6}$/i.test(partial.accent)
      ? partial.accent.toLowerCase()
      : DEFAULT_SETTINGS.accent;
  const density: UiDensity = ['compact', 'comfortable', 'spacious'].includes(
    partial.density as string,
  )
    ? (partial.density as UiDensity)
    : DEFAULT_SETTINGS.density;
  const backgroundStyle: BackgroundStyle = ['midnight', 'aurora', 'studio', 'nebula', 'ember', 'frost', 'cinema'].includes(
    partial.backgroundStyle as string,
  )
    ? (partial.backgroundStyle as BackgroundStyle)
    : DEFAULT_SETTINGS.backgroundStyle;
  const cardStyle: CardStyle = ['glass', 'solid', 'soft', 'outline'].includes(
    partial.cardStyle as string,
  )
    ? (partial.cardStyle as CardStyle)
    : DEFAULT_SETTINGS.cardStyle;
  const captionMode: CaptionMode = ['youtube-default', 'always-on'].includes(
    partial.captionMode as string,
  )
    ? (partial.captionMode as CaptionMode)
    : DEFAULT_SETTINGS.captionMode;
  const captionLanguage: CaptionLanguage = ['auto', 'en', 'es', 'fr', 'de', 'pt', 'ja', 'ko'].includes(
    partial.captionLanguage as string,
  )
    ? (partial.captionLanguage as CaptionLanguage)
    : DEFAULT_SETTINGS.captionLanguage;
  const captionSize = Number(partial.captionFontSize);
  const captionFontSize: CaptionFontSize = [-1, 0, 1, 2, 3].includes(captionSize)
    ? (captionSize as CaptionFontSize)
    : DEFAULT_SETTINGS.captionFontSize;
  const uiFont: UiFont = ['system', 'cinematic', 'editorial', 'modern', 'classic', 'comic', 'mono'].includes(
    partial.uiFont as string,
  )
    ? (partial.uiFont as UiFont)
    : DEFAULT_SETTINGS.uiFont;
  return {
    theme,
    accent,
    accentGlowPercent: clamp(Number(partial.accentGlowPercent ?? 55) || 0, 0, 100),
    cornerRadiusPx: clamp(Number(partial.cornerRadiusPx ?? 16) || 0, 4, 28),
    density,
    backgroundStyle,
    cardStyle,
    customAtmosphere: {
      canvas: safeColor(customAtmosphere.canvas, DEFAULT_SETTINGS.customAtmosphere.canvas),
      surface: safeColor(customAtmosphere.surface, DEFAULT_SETTINGS.customAtmosphere.surface),
      panel: safeColor(customAtmosphere.panel, DEFAULT_SETTINGS.customAtmosphere.panel),
    },
    reduceMotion: typeof partial.reduceMotion === 'boolean' ? partial.reduceMotion : false,
    highContrast: typeof partial.highContrast === 'boolean' ? partial.highContrast : false,
    textScalePercent: clamp(Number(partial.textScalePercent ?? 100) || 100, 90, 125),
    reduceTransparency:
      typeof partial.reduceTransparency === 'boolean' ? partial.reduceTransparency : false,
    enhancedFocus: typeof partial.enhancedFocus === 'boolean' ? partial.enhancedFocus : true,
    hoverPreviewEnabled:
      typeof partial.hoverPreviewEnabled === 'boolean' ? partial.hoverPreviewEnabled : true,
    miniPlayerEnabled:
      typeof partial.miniPlayerEnabled === 'boolean' ? partial.miniPlayerEnabled : true,
    captionMode,
    captionLanguage,
    captionFontSize,
    uiFont,
    customBackgroundImage: safeBackgroundImage(partial.customBackgroundImage),
    customBackgroundEnabled:
      typeof partial.customBackgroundEnabled === 'boolean'
        ? partial.customBackgroundEnabled
        : false,
    profileBackgroundEnabled:
      typeof partial.profileBackgroundEnabled === 'boolean'
        ? partial.profileBackgroundEnabled
        : false,
    chatFilterEnabled:
      typeof partial.chatFilterEnabled === 'boolean' ? partial.chatFilterEnabled : true,
    richPresenceEnabled:
      typeof partial.richPresenceEnabled === 'boolean' ? partial.richPresenceEnabled : true,
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

  public update(partial: Partial<Omit<Settings, 'videoFilters' | 'customAtmosphere'>> & { videoFilters?: Partial<VideoFilters>; customAtmosphere?: Partial<CustomAtmosphere> }): void {
    this.settings = sanitize({
      ...this.settings,
      ...partial,
      videoFilters: { ...this.settings.videoFilters, ...partial.videoFilters },
      customAtmosphere: { ...this.settings.customAtmosphere, ...partial.customAtmosphere },
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
