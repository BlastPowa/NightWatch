import {
  ACCENT_COLORS,
  DEFAULT_SETTINGS,
  NEUTRAL_FILTERS,
  THEMES,
  settingsStore,
} from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';

/** Theme swatch background preview per theme id. */
const THEME_PREVIEW: Record<string, string> = {
  'electric-teal': '#0b0e14',
  'shiny-gold': '#0f0c06',
  legacy: '#1b1e24',
};

/** Local personalization page: accent, background theme, volume, filters. */
export function SettingsPanel(): JSX.Element {
  const settings = useSettings();

  return (
    <div className="settings-page fade-up">
      <header className="page-header">
        <span className="eyebrow">Personalization</span>
        <h1 className="page-title">Settings</h1>
        <p className="page-lede">Tune NightWatch for your room. These choices stay on this device.</p>
      </header>

      <section className="card settings-card">
        <h2 className="settings-heading">Accent color</h2>
        <p className="settings-description">
          Choose the moonlight color used for actions, focus, and room presence.
        </p>
        <div className="swatch-row">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch${settings.accent === color ? ' swatch-active' : ''}`}
              style={{ background: color }}
              title={color}
              aria-label={`Use accent color ${color}`}
              aria-pressed={settings.accent === color}
              onClick={() => settingsStore.update({ accent: color })}
            />
          ))}
        </div>
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Background</h2>
        <p className="settings-description">
          Switch the atmosphere without changing your room or playback.
        </p>
        <div className="swatch-row">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`swatch swatch-wide${settings.theme === theme.id ? ' swatch-active' : ''}`}
              style={{ background: THEME_PREVIEW[theme.id] }}
              title={theme.label}
              aria-pressed={settings.theme === theme.id}
              onClick={() => settingsStore.update({ theme: theme.id })}
            >
              <span className="swatch-label">{theme.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Volume — {settings.volumePercent}%</h2>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.volumePercent}
          onChange={(e) => settingsStore.update({ volumePercent: Number(e.target.value) })}
        />
      </section>

      <section className="card settings-card">
        <h2 className="settings-heading">Video filters</h2>
        <label className="filter-row">
          <span>Brightness {settings.videoFilters.brightness}%</span>
          <input
            type="range"
            min={50}
            max={150}
            value={settings.videoFilters.brightness}
            onChange={(e) =>
              settingsStore.update({ videoFilters: { brightness: Number(e.target.value) } })
            }
          />
        </label>
        <label className="filter-row">
          <span>Contrast {settings.videoFilters.contrast}%</span>
          <input
            type="range"
            min={50}
            max={150}
            value={settings.videoFilters.contrast}
            onChange={(e) =>
              settingsStore.update({ videoFilters: { contrast: Number(e.target.value) } })
            }
          />
        </label>
        <label className="filter-row">
          <span>Saturation {settings.videoFilters.saturation}%</span>
          <input
            type="range"
            min={50}
            max={150}
            value={settings.videoFilters.saturation}
            onChange={(e) =>
              settingsStore.update({ videoFilters: { saturation: Number(e.target.value) } })
            }
          />
        </label>
        <button
          type="button"
          className="button"
          onClick={() => settingsStore.update({ videoFilters: NEUTRAL_FILTERS })}
        >
          Reset filters
        </button>
      </section>

      <button
        type="button"
        className="button button-danger"
        onClick={() => settingsStore.update(DEFAULT_SETTINGS)}
      >
        ↺ Reset to NightWatch default
      </button>
    </div>
  );
}
