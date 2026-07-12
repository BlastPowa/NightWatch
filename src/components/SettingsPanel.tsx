import { useState } from 'react';
import type { AuthUser } from '@/lib/auth';
import { signInWithDiscord, signOut } from '@/lib/auth';
import {
  ACCENT_COLORS,
  DEFAULT_SETTINGS,
  NEUTRAL_FILTERS,
  THEMES,
  settingsStore,
} from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';
import { ProfileAvatar } from '@/components/ProfileAvatar';

interface SettingsPanelProps {
  user: AuthUser | null;
}

type SettingsSection = 'appearance' | 'playback' | 'social' | 'accessibility' | 'account' | 'data';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: string }> = [
  { id: 'appearance', label: 'Appearance', icon: '✦' },
  { id: 'playback', label: 'Playback', icon: '▶' },
  { id: 'social', label: 'Social', icon: '◉' },
  { id: 'accessibility', label: 'Accessibility', icon: '⌘' },
  { id: 'account', label: 'Account', icon: '◎' },
  { id: 'data', label: 'Local data', icon: '◇' },
];

const THEME_PREVIEW: Record<string, string> = {
  'electric-teal': 'linear-gradient(135deg,#080b16 50%,#173443 50%)',
  'shiny-gold': 'linear-gradient(135deg,#0f0c06 50%,#4b3a0c 50%)',
  legacy: 'linear-gradient(135deg,#1b1e24 50%,#3a4254 50%)',
  'moonlit-violet': 'linear-gradient(135deg,#0c0918 50%,#39295f 50%)',
  'crimson-theatre': 'linear-gradient(135deg,#120708 50%,#5b2027 50%)',
  oceanic: 'linear-gradient(135deg,#04111b 50%,#164b68 50%)',
  evergreen: 'linear-gradient(135deg,#06110e 50%,#1d4a3b 50%)',
  'rose-noir': 'linear-gradient(135deg,#120912 50%,#512640 50%)',
};

export function SettingsPanel({ user }: SettingsPanelProps): JSX.Element {
  const settings = useSettings();
  const [section, setSection] = useState<SettingsSection>('appearance');

  return (
    <div className="settings-workspace fade-up">
      <aside className="settings-rail" aria-label="Settings categories">
        <div className="settings-rail-heading">
          <span className="eyebrow">Control room</span>
          <h1 className="page-title">Settings</h1>
        </div>
        <nav className="settings-nav">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${section === item.id ? ' settings-nav-item-active' : ''}`}
              onClick={() => setSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <p className="settings-local-note">Changes apply instantly and stay on this device.</p>
      </aside>

      <div className="settings-content">
        {section === 'appearance' && (
          <>
            <SettingsHeader title="Theme & appearance" description="Shape the room around the way you watch." />
            <section className="settings-grid settings-grid-two">
              <div className="card settings-card settings-card-wide">
                <h2>Atmosphere</h2>
                <div className="theme-grid">
                  {THEMES.map((theme) => (
                    <button key={theme.id} type="button" className={`theme-tile${settings.theme === theme.id ? ' theme-tile-active' : ''}`} onClick={() => settingsStore.update({ theme: theme.id })} aria-pressed={settings.theme === theme.id}>
                      <span className="theme-preview" style={{ background: THEME_PREVIEW[theme.id] }} />
                      <span>{theme.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card settings-card">
                <h2>Accent</h2>
                <div className="swatch-row">
                  {ACCENT_COLORS.map((color) => <button key={color} type="button" className={`swatch${settings.accent === color ? ' swatch-active' : ''}`} style={{ background: color }} aria-label={`Use ${color}`} aria-pressed={settings.accent === color} onClick={() => settingsStore.update({ accent: color })} />)}
                  <label className="custom-color" title="Custom accent color"><input type="color" value={settings.accent} onChange={(event) => settingsStore.update({ accent: event.target.value })} /><span>Custom</span></label>
                </div>
                <RangeSetting label="Accent glow" value={settings.accentGlowPercent} min={0} max={100} unit="%" onChange={(accentGlowPercent) => settingsStore.update({ accentGlowPercent })} />
                <RangeSetting label="Corner radius" value={settings.cornerRadiusPx} min={4} max={28} unit="px" onChange={(cornerRadiusPx) => settingsStore.update({ cornerRadiusPx })} />
              </div>
              <div className="card settings-card">
                <h2>Layout density</h2>
                <Segmented values={['compact','comfortable','spacious']} active={settings.density} onSelect={(density) => settingsStore.update({ density })} />
              </div>
              <div className="card settings-card">
                <h2>Backdrop</h2>
                <Segmented values={['midnight','aurora','studio']} active={settings.backgroundStyle} onSelect={(backgroundStyle) => settingsStore.update({ backgroundStyle })} />
              </div>
            </section>
          </>
        )}

        {section === 'playback' && (
          <><SettingsHeader title="Playback" description="Local controls applied through the official player API and safe CSS filters." /><section className="settings-grid settings-grid-two">
            <div className="card settings-card"><h2>Sound</h2><p>Sets your local player volume without changing anyone else’s.</p><RangeSetting label="Player volume" value={settings.volumePercent} min={0} max={100} unit="%" onChange={(volumePercent) => settingsStore.update({ volumePercent })} /><div className="quick-actions"><button type="button" className="button" onClick={() => settingsStore.update({ volumePercent: 0 })}>Mute</button><button type="button" className="button" onClick={() => settingsStore.update({ volumePercent: 50 })}>50%</button><button type="button" className="button" onClick={() => settingsStore.update({ volumePercent: 100 })}>Full</button></div></div>
            <div className="card settings-card"><h2>Picture preset</h2><p>Safe local filters around the official YouTube player.</p><div className="preset-actions"><button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: NEUTRAL_FILTERS })}>Neutral</button><button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: { brightness: 92, contrast: 112, saturation: 105 } })}>Cinema</button><button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: { brightness: 105, contrast: 108, saturation: 120 } })}>Vivid</button></div></div>
            <div className="card settings-card settings-card-wide"><h2>Fine-tune video image</h2>{(['brightness','contrast','saturation'] as const).map((key) => <RangeSetting key={key} label={key} value={settings.videoFilters[key]} min={50} max={150} unit="%" onChange={(value) => settingsStore.update({ videoFilters: { [key]: value } })} />)}<button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: NEUTRAL_FILTERS })}>Reset video image</button></div>
          </section></>
        )}

        {section === 'social' && (
          <><SettingsHeader title="Social" description="Choose what NightWatch shares and filters." /><section className="settings-grid"><ToggleCard title="Discord Rich Presence" description="Show what you are watching without exposing the room code." checked={settings.richPresenceEnabled} onChange={(richPresenceEnabled) => settingsStore.update({ richPresenceEnabled })} /><ToggleCard title="Message filter" description="Filter profanity in messages you send before everyone receives them." checked={settings.chatFilterEnabled} onChange={(chatFilterEnabled) => settingsStore.update({ chatFilterEnabled })} /></section></>
        )}

        {section === 'accessibility' && (
          <><SettingsHeader title="Accessibility" description="Tune readability, motion, transparency, and keyboard focus for this device." /><section className="settings-grid settings-grid-two"><div className="card settings-card settings-card-wide"><h2>Text size</h2><p>Scale NightWatch interface text without changing the YouTube player.</p><RangeSetting label="Interface text" value={settings.textScalePercent} min={90} max={125} unit="%" onChange={(textScalePercent) => settingsStore.update({ textScalePercent })} /></div><ToggleCard title="Reduce motion" description="Minimize entrances, shimmer, hover movement, and reaction travel." checked={settings.reduceMotion} onChange={(reduceMotion) => settingsStore.update({ reduceMotion })} /><ToggleCard title="Higher contrast" description="Strengthen text and borders across every theme." checked={settings.highContrast} onChange={(highContrast) => settingsStore.update({ highContrast })} /><ToggleCard title="Reduce transparency" description="Replace glass and translucent surfaces with solid backgrounds." checked={settings.reduceTransparency} onChange={(reduceTransparency) => settingsStore.update({ reduceTransparency })} /><ToggleCard title="Enhanced keyboard focus" description="Show a stronger focus ring when navigating controls with a keyboard." checked={settings.enhancedFocus} onChange={(enhancedFocus) => settingsStore.update({ enhancedFocus })} /></section></>
        )}

        {section === 'account' && (
          <><SettingsHeader title="Account" description="Discord identity powers persistent rooms. YouTube account connection is intentionally not enabled without secure OAuth." /><section className="settings-grid"><div className="card settings-card account-card"><ProfileAvatar src={user?.avatarUrl ?? null} name={user?.name ?? 'Guest'} className="account-avatar" /><div><h2>{user?.name ?? 'Guest mode'}</h2><p>{user ? 'Connected with Discord' : 'Sign in to create and manage persistent rooms.'}</p></div><button type="button" className="button button-primary" onClick={() => void (user ? signOut() : signInWithDiscord())}>{user ? 'Sign out' : 'Connect Discord'}</button></div><div className="card settings-card settings-card-muted"><h2>YouTube account</h2><p>Planned separately after Google OAuth, secure token storage, consent, revocation, and scope review. NightWatch never signs into or alters the embedded player session.</p></div></section></>
        )}

        {section === 'data' && (
          <><SettingsHeader title="Local data" description="NightWatch settings remain in local storage on this device." /><section className="settings-grid"><div className="card settings-card"><h2>Reset appearance</h2><p>Restore the default theme, accent, glow, radius, density, and accessibility presentation.</p><button type="button" className="button" onClick={() => settingsStore.update({ theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent, accentGlowPercent: DEFAULT_SETTINGS.accentGlowPercent, cornerRadiusPx: DEFAULT_SETTINGS.cornerRadiusPx, density: DEFAULT_SETTINGS.density, backgroundStyle: DEFAULT_SETTINGS.backgroundStyle, reduceMotion: DEFAULT_SETTINGS.reduceMotion, highContrast: DEFAULT_SETTINGS.highContrast, textScalePercent: DEFAULT_SETTINGS.textScalePercent, reduceTransparency: DEFAULT_SETTINGS.reduceTransparency, enhancedFocus: DEFAULT_SETTINGS.enhancedFocus })}>Reset appearance</button></div><div className="card settings-card"><h2>Reset every setting</h2><p>Restore playback, social, and appearance preferences to NightWatch defaults.</p><button type="button" className="button button-danger" onClick={() => settingsStore.update(DEFAULT_SETTINGS)}>Reset all settings</button></div></section></>
        )}
      </div>
    </div>
  );
}

function SettingsHeader({ title, description }: { title: string; description: string }): JSX.Element { return <header className="settings-section-header"><span className="eyebrow">NightWatch preferences</span><h2>{title}</h2><p>{description}</p></header>; }
function RangeSetting({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange(value: number): void }): JSX.Element { return <label className="range-setting"><span><span className="range-label">{label}</span><output>{value}{unit}</output></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function ToggleCard({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange(value: boolean): void }): JSX.Element { return <label className="card settings-card toggle-card"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-switch" aria-hidden="true" /></label>; }
function Segmented<T extends string>({ values, active, onSelect }: { values: readonly T[]; active: T; onSelect(value: T): void }): JSX.Element { return <div className="segmented">{values.map((value) => <button key={value} type="button" className={active === value ? 'segmented-active' : ''} onClick={() => onSelect(value)} aria-pressed={active === value}>{value}</button>)}</div>; }
