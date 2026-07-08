import { NEUTRAL_FILTERS, THEMES, settingsStore } from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';

/** Local personalization: theme, volume, video filters (ADR-009/010). */
export function SettingsPanel(): JSX.Element {
  const settings = useSettings();

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h2 className="settings-heading">Theme</h2>
        <div className="theme-options">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`button theme-option${settings.theme === theme.id ? ' theme-option-active' : ''}`}
              onClick={() => settingsStore.update({ theme: theme.id })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-heading">Volume — {settings.volumePercent}%</h2>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.volumePercent}
          onChange={(e) => settingsStore.update({ volumePercent: Number(e.target.value) })}
        />
      </section>

      <section className="settings-section">
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
    </div>
  );
}
