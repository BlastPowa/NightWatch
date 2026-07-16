import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { AuthUser } from '@/lib/auth';
import { signInWithDiscord, signOut } from '@/lib/auth';
import {
  ACCENT_COLORS,
  DEFAULT_SETTINGS,
  NEUTRAL_FILTERS,
  THEMES,
  settingsStore,
  type BackgroundStyle,
  type CardStyle,
  type CaptionFontSize,
  type CaptionLanguage,
  type CaptionMode,
  type UiFont,
} from '@/lib/settings';
import { useSettings } from '@/hooks/useSettings';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Icon, type IconName } from '@/components/Icon';
import {
  getPresencePreferences,
  setPresencePreferences,
  type PresencePreferences,
} from '@/lib/social/PresenceService';
import './SettingsPanel.css';
import '@/styles/phase27-secondary.css';
import '@/styles/phase28-settings.css';

interface SettingsPanelProps {
  user: AuthUser | null;
  driveAvailable?: boolean;
  onOpenLibrary?(): void;
}

type SettingsSection = 'appearance' | 'browsing' | 'playback' | 'social' | 'accessibility' | 'account' | 'data';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: 'appearance', label: 'Appearance', icon: 'sparkle' },
  { id: 'browsing', label: 'Browsing', icon: 'search' },
  { id: 'playback', label: 'Playback', icon: 'play' },
  { id: 'social', label: 'Social', icon: 'friends' },
  { id: 'accessibility', label: 'Accessibility', icon: 'settings' },
  { id: 'account', label: 'Account', icon: 'profile' },
  { id: 'data', label: 'Local data', icon: 'lock' },
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
  doomsday: 'linear-gradient(135deg,#090b0d 42%,#24352e 42% 72%,#a76a2a 72%)',
  'brand-new-day': 'linear-gradient(135deg,#07101f 42%,#163c73 42% 68%,#b8172b 68%)',
  'alien-x': 'linear-gradient(135deg,#020507 44%,#e7f5ef 44% 56%,#0ba86b 56%)',
  obsidian: 'linear-gradient(135deg,#000 50%,#111217 50%)',
  'obsidian-red': 'linear-gradient(135deg,#010103 48%,#210509 48% 72%,#8f1422 72%)',
  'obsidian-blue': 'linear-gradient(135deg,#010207 48%,#07152e 48% 72%,#2463d4 72%)',
  'ember-noir': 'linear-gradient(135deg,#090403 44%,#341009 44% 70%,#ef6b24 70%)',
  'arctic-light': 'linear-gradient(135deg,#edf8ff 44%,#b9dff5 44% 68%,#2c84ad 68%)',
  'solar-flare': 'linear-gradient(135deg,#120704 42%,#65210a 42% 70%,#ffb21d 70%)',
  'neon-night': 'linear-gradient(135deg,#060416 42%,#2b0c55 42% 68%,#d91bcf 68%)',
  custom: 'conic-gradient(from 225deg,#050507,#512640,#164b68,#1d4a3b,#050507)',
};

const THEME_DESCRIPTION: Record<string, string> = {
  'electric-teal': 'Deep blue with a cool teal signal.',
  'shiny-gold': 'Warm black with theatre-gold highlights.',
  legacy: 'Neutral graphite with softened blue-grey depth.',
  'moonlit-violet': 'Ink-black surfaces with violet moonlight.',
  'crimson-theatre': 'Dark velvet with restrained crimson warmth.',
  oceanic: 'Abyssal navy with clear ocean-blue contrast.',
  evergreen: 'Forest-black with calm emerald detail.',
  'rose-noir': 'Near-black plum with cinematic rose accents.',
  doomsday: 'Latverian steel, shadowed emerald, and molten bronze.',
  'brand-new-day': 'Suit-red energy over midnight blue and cool web-silver.',
  'alien-x': 'Starfield black, cosmic white, and transformed green light.',
  obsidian: 'True black canvas with crisp graphite surfaces.',
  'obsidian-red': 'Black glass cut with a controlled ruby signal.',
  'obsidian-blue': 'Ink-black depth with electric cobalt edges.',
  'ember-noir': 'Smoke-dark surfaces lit by warm ember orange.',
  'arctic-light': 'A bright frost palette with legible deep-blue type.',
  'solar-flare': 'Solar gold and orange burning through theatre black.',
  'neon-night': 'Midnight violet with vivid magenta and cyan energy.',
  custom: 'Build a personal canvas, surface, and panel palette.',
};

const BACKDROPS: ReadonlyArray<{ id: BackgroundStyle; label: string; description: string }> = [
  { id: 'midnight', label: 'Midnight', description: 'Moving moon-blue and accent horizons over deep black.' },
  { id: 'aurora', label: 'Aurora', description: 'Wide animated ribbons of accent and secondary colour.' },
  { id: 'studio', label: 'Studio', description: 'A flat, distraction-free background for maximum clarity.' },
  { id: 'nebula', label: 'Nebula', description: 'Violet and blue clouds drifting behind the workspace.' },
  { id: 'ember', label: 'Ember', description: 'Slow red-orange warmth rising through theatre black.' },
  { id: 'frost', label: 'Frost', description: 'Cool pale-blue light with a crisp glass horizon.' },
  { id: 'cinema', label: 'Cinema', description: 'Subtle projector vignette with a warm centre stage.' },
];

const CARD_STYLES: ReadonlyArray<{ id: CardStyle; label: string; description: string }> = [
  { id: 'glass', label: 'Glass', description: 'Layered translucent depth with restrained blur.' },
  { id: 'solid', label: 'Solid', description: 'Opaque panels with crisp, dependable contrast.' },
  { id: 'soft', label: 'Soft', description: 'Border-light cards with deeper cinematic shadows.' },
  { id: 'outline', label: 'Outline', description: 'Minimal surfaces with accent-traced edges.' },
];

const FONT_OPTIONS: ReadonlyArray<{ id: UiFont; label: string; description: string }> = [
  { id: 'system', label: 'System', description: 'The clearest native interface font.' },
  { id: 'cinematic', label: 'Cinematic', description: 'Wide, confident titles for a theatre feel.' },
  { id: 'editorial', label: 'Editorial', description: 'Refined serif headings with readable body copy.' },
  { id: 'modern', label: 'Modern', description: 'Clean geometric styling with compact rhythm.' },
  { id: 'classic', label: 'Classic', description: 'Familiar humanist forms for long sessions.' },
  { id: 'comic', label: 'Comic', description: 'A playful local display choice.' },
  { id: 'mono', label: 'Monospace', description: 'Technical, evenly spaced interface text.' },
];

const CAPTION_LANGUAGES: ReadonlyArray<{ value: CaptionLanguage; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
];

const CAPTION_SIZES: ReadonlyArray<{ value: CaptionFontSize; label: string }> = [
  { value: -1, label: 'Small' },
  { value: 0, label: 'Default' },
  { value: 1, label: 'Large' },
  { value: 3, label: 'Extra large' },
];

export function SettingsPanel({ user, driveAvailable = false, onOpenLibrary }: SettingsPanelProps): JSX.Element {
  const settings = useSettings();
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [backgroundState, setBackgroundState] = useState<'idle' | 'processing' | 'error'>('idle');
  const customPaletteStatus = getCustomPaletteStatus(settings.customAtmosphere);
  const previewStyle = {
    '--p27-preview-accent': settings.accent,
    '--p27-preview-canvas': settings.theme === 'custom' ? settings.customAtmosphere.canvas : '#070914',
    '--p27-preview-surface': settings.theme === 'custom' ? settings.customAtmosphere.surface : '#171a2d',
    '--p27-preview-panel': settings.theme === 'custom' ? settings.customAtmosphere.panel : '#0d1020',
    '--p27-preview-theme': THEME_PREVIEW[settings.theme],
  } as CSSProperties;

  async function chooseCustomBackground(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setBackgroundState('processing');
    try {
      const customBackgroundImage = await resizeBackgroundImage(file);
      settingsStore.update({
        customBackgroundImage,
        customBackgroundEnabled: true,
        profileBackgroundEnabled: true,
      });
      setBackgroundState('idle');
    } catch {
      setBackgroundState('error');
    }
  }

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
              aria-label={item.label}
              title={item.label}
            >
              <span><Icon name={item.icon} /></span>{item.label}
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
              <div className="card settings-card settings-card-wide p27-live-preview-card">
                <div className="p27-preview-copy">
                  <span className="eyebrow">Live preview</span>
                  <h2>Your NightWatch room</h2>
                  <p>Atmosphere, accent, radius, density, and backdrop changes appear here instantly.</p>
                </div>
                <div className={`p27-live-preview p27-preview-${settings.backgroundStyle}`} style={previewStyle} role="img" aria-label={`Preview of ${THEMES.find((theme) => theme.id === settings.theme)?.label ?? 'selected'} atmosphere`}>
                  <span className="p27-preview-bar"><i /><i /><i /><b /></span>
                  <span className="p27-preview-shell">
                    <i className="p27-preview-rail"><b /><b /><b /></i>
                    <i className="p27-preview-stage"><b /><span><b /><b /><b /></span></i>
                  </span>
                </div>
              </div>
              <div className="card settings-card settings-card-wide">
                <h2>Atmosphere</h2>
                <div className="theme-grid">
                  {THEMES.map((theme) => (
                    <button key={theme.id} type="button" className={`theme-tile${settings.theme === theme.id ? ' theme-tile-active' : ''}`} onClick={() => settingsStore.update({ theme: theme.id })} aria-pressed={settings.theme === theme.id}>
                      <span className="theme-preview" style={{ background: THEME_PREVIEW[theme.id] }} aria-hidden="true"><span /></span>
                      <span className="theme-tile-copy"><strong>{theme.label}{settings.theme === theme.id && <em>Live</em>}</strong><small>{THEME_DESCRIPTION[theme.id]}</small></span>
                    </button>
                  ))}
                </div>
              </div>
              {settings.theme === 'custom' && <div className="card settings-card settings-card-wide custom-atmosphere-card p27-custom-atmosphere"><div className="p27-custom-copy"><span className="eyebrow">Palette studio</span><h2>Custom atmosphere</h2><p>Canvas sits behind the app, Surface holds cards, and Panel separates controls. Accent, glow, and accessibility settings remain independent.</p><div className={`p27-contrast-status${customPaletteStatus.safe ? ' p27-contrast-safe' : ' p27-contrast-warning'}`} role="status"><Icon name={customPaletteStatus.safe ? 'sparkle' : 'info'} /><span><strong>{customPaletteStatus.safe ? 'Balanced separation' : 'Contrast needs attention'}</strong><small>{customPaletteStatus.message}</small></span></div></div><div className="custom-atmosphere-grid">{([['canvas','Canvas'],['surface','Surface'],['panel','Panel']] as const).map(([key,label]) => <label key={key} className="atmosphere-color"><input type="color" value={settings.customAtmosphere[key]} aria-label={`${label} colour`} onChange={(event) => settingsStore.update({ customAtmosphere: { [key]: event.target.value } })} /><span><strong>{label}</strong><small>{settings.customAtmosphere[key]}</small></span></label>)}</div></div>}
              <div className="card settings-card">
                <h2>Accent</h2>
                <div className="swatch-row">
                  {ACCENT_COLORS.map((color) => <button key={color} type="button" className={`swatch${settings.accent === color ? ' swatch-active' : ''}`} style={{ background: color }} aria-label={`Use ${color}`} aria-pressed={settings.accent === color} onClick={() => settingsStore.update({ accent: color })} />)}
                  <label className="custom-color" title="Custom accent color"><input type="color" value={settings.accent} aria-label="Choose a custom accent color" onChange={(event) => settingsStore.update({ accent: event.target.value })} /><span>Custom</span></label>
                </div>
                <RangeSetting label="Accent glow" value={settings.accentGlowPercent} min={0} max={100} unit="%" onChange={(accentGlowPercent) => settingsStore.update({ accentGlowPercent })} />
                <RangeSetting label="Corner radius" value={settings.cornerRadiusPx} min={4} max={28} unit="px" onChange={(cornerRadiusPx) => settingsStore.update({ cornerRadiusPx })} />
              </div>
              <div className="card settings-card">
                <h2>Layout density</h2>
                <Segmented values={['compact','comfortable','spacious']} active={settings.density} onSelect={(density) => settingsStore.update({ density })} />
              </div>
              <div className="card settings-card settings-card-wide">
                <h2>Interface type</h2>
                <p>Choose a local or system font profile. NightWatch does not bundle proprietary streaming-brand typefaces.</p>
                <div className="font-option-grid" role="group" aria-label="Interface font">
                  {FONT_OPTIONS.map((font) => (
                    <button
                      key={font.id}
                      type="button"
                      className={`font-option font-option-${font.id}${settings.uiFont === font.id ? ' font-option-active' : ''}`}
                      aria-pressed={settings.uiFont === font.id}
                      onClick={() => settingsStore.update({ uiFont: font.id })}
                    >
                      <strong>{font.label}</strong>
                      <small>{font.description}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card settings-card">
                <h2>Backdrop</h2>
                <div className="backdrop-grid">
                  {BACKDROPS.map((backdrop) => <button key={backdrop.id} type="button" className={`backdrop-option${settings.backgroundStyle === backdrop.id ? ' backdrop-option-active' : ''}`} aria-pressed={settings.backgroundStyle === backdrop.id} onClick={() => settingsStore.update({ backgroundStyle: backdrop.id })}><span className={`backdrop-preview backdrop-preview-${backdrop.id}`} aria-hidden="true"><i /><b /></span><span><strong>{backdrop.label}{settings.backgroundStyle === backdrop.id && <em>Selected</em>}</strong><small>{backdrop.description}</small></span></button>)}
                </div>
              </div>
              <div className="card settings-card settings-card-wide custom-background-card">
                <div className="custom-background-copy">
                  <span className="eyebrow">Personal artwork</span>
                  <h2>Custom background</h2>
                  <p>Choose a JPEG, PNG, or WebP image. NightWatch resizes it for the app, stores it only on this device, and never uploads it to a room or profile service.</p>
                  {backgroundState === 'error' && <span className="custom-background-error" role="alert">That image could not be prepared. Try a smaller JPEG, PNG, or WebP file.</span>}
                  <div className="custom-background-actions">
                    <label className="button button-primary custom-background-upload">
                      <Icon name="upload" size={16} />
                      {backgroundState === 'processing' ? 'Preparing image…' : settings.customBackgroundImage === null ? 'Choose background' : 'Replace background'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={backgroundState === 'processing'}
                        onChange={(event) => {
                          void chooseCustomBackground(event.target.files?.[0]);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {settings.customBackgroundImage !== null && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => settingsStore.update({
                          customBackgroundImage: null,
                          customBackgroundEnabled: false,
                          profileBackgroundEnabled: false,
                        })}
                      >
                        <Icon name="close" size={15} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`custom-background-preview${settings.customBackgroundImage === null ? ' custom-background-preview-empty' : ''}`}
                  style={settings.customBackgroundImage === null ? undefined : { backgroundImage: `url(${settings.customBackgroundImage})` }}
                >
                  {settings.customBackgroundImage === null && <><Icon name="image" size={28} /><span>Your artwork preview</span></>}
                </div>
                <div className="custom-background-toggles">
                  <ToggleLine
                    title="Use across the app"
                    description="Layer this image behind NightWatch screens."
                    checked={settings.customBackgroundEnabled}
                    disabled={settings.customBackgroundImage === null}
                    onChange={(customBackgroundEnabled) => settingsStore.update({ customBackgroundEnabled })}
                  />
                  <ToggleLine
                    title="Use on my profile"
                    description="Turn the Profile page into a full artwork showcase."
                    checked={settings.profileBackgroundEnabled}
                    disabled={settings.customBackgroundImage === null}
                    onChange={(profileBackgroundEnabled) => settingsStore.update({ profileBackgroundEnabled })}
                  />
                </div>
              </div>
              <div className="card settings-card">
                <h2>Card surfaces</h2>
                <p>Change panel depth without changing layout or readability.</p>
                <div className="card-style-grid" role="group" aria-label="Card surface style">
                  {CARD_STYLES.map((cardStyle) => <button key={cardStyle.id} type="button" className={`card-style-option card-style-${cardStyle.id}${settings.cardStyle === cardStyle.id ? ' card-style-option-active' : ''}`} aria-pressed={settings.cardStyle === cardStyle.id} onClick={() => settingsStore.update({ cardStyle: cardStyle.id })}><span aria-hidden="true"><i /><i /></span><strong>{cardStyle.label}</strong><small>{cardStyle.description}</small></button>)}
                </div>
              </div>
            </section>
          </>
        )}

        {section === 'browsing' && (
          <>
            <SettingsHeader title="Browsing" description="Control discovery previews and keep the room close while you explore." />
            <section className="settings-grid settings-grid-two">
              <ToggleCard
                title="Hover video previews"
                description="After a short desktop hover, load a muted preview through the official YouTube player. Disabled automatically for touch and reduced motion."
                checked={settings.hoverPreviewEnabled}
                onChange={(hoverPreviewEnabled) => settingsStore.update({ hoverPreviewEnabled })}
              />
              <ToggleCard
                title="Show mini-player while browsing"
                description="Keep the same synchronized room player visible when you visit Browse, Friends, Messages, Profile, or Settings."
                checked={settings.miniPlayerEnabled}
                onChange={(miniPlayerEnabled) => settingsStore.update({ miniPlayerEnabled })}
              />
              <div className="card settings-card settings-card-wide settings-boundary-note">
                <Icon name="info" />
                <div>
                  <h2>Official playback boundary</h2>
                  <p>Previews begin muted and use YouTube controls. The mini-player reuses the active room player so playback is not duplicated or proxied.</p>
                </div>
              </div>
            </section>
          </>
        )}

        {section === 'playback' && (
          <><SettingsHeader title="Playback" description="Local controls applied through the official player API and safe CSS filters." /><section className="settings-grid settings-grid-two">
            <div className="card settings-card"><h2>Sound</h2><p>Sets your local player volume without changing anyone else’s.</p><RangeSetting label="Player volume" value={settings.volumePercent} min={0} max={100} unit="%" onChange={(volumePercent) => settingsStore.update({ volumePercent })} /><div className="quick-actions" aria-label="Volume presets"><button type="button" className="button" aria-pressed={settings.volumePercent === 0} onClick={() => settingsStore.update({ volumePercent: 0 })}>Mute</button><button type="button" className="button" aria-pressed={settings.volumePercent === 50} onClick={() => settingsStore.update({ volumePercent: 50 })}>50%</button><button type="button" className="button" aria-pressed={settings.volumePercent === 100} onClick={() => settingsStore.update({ volumePercent: 100 })}>Full</button></div></div>
            <div className="card settings-card"><h2>Picture preset</h2><p>Safe local filters around the official YouTube player.</p><div className="preset-actions"><button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: NEUTRAL_FILTERS })}>Neutral</button><button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: { brightness: 92, contrast: 112, saturation: 105 } })}>Cinema</button><button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: { brightness: 105, contrast: 108, saturation: 120 } })}>Vivid</button></div></div>
            <div className="card settings-card settings-card-wide"><h2>Fine-tune video image</h2>{(['brightness','contrast','saturation'] as const).map((key) => <RangeSetting key={key} label={key} value={settings.videoFilters[key]} min={50} max={150} unit="%" onChange={(value) => settingsStore.update({ videoFilters: { [key]: value } })} />)}<button type="button" className="button" onClick={() => settingsStore.update({ videoFilters: NEUTRAL_FILTERS })}>Reset video image</button></div>
            <div className="card settings-card settings-card-wide caption-preferences">
              <div>
                <h2>Automatic captions</h2>
                <p>Prefer caption tracks supplied by YouTube. Language and behavior changes apply when the official player initializes again.</p>
              </div>
              <div className="settings-field-grid">
                <fieldset className="settings-fieldset">
                  <legend>Caption behavior</legend>
                  <Segmented
                    values={['youtube-default', 'always-on'] as const}
                    labels={{ 'youtube-default': 'Follow YouTube', 'always-on': 'Prefer captions' }}
                    active={settings.captionMode}
                    onSelect={(captionMode: CaptionMode) => settingsStore.update({ captionMode })}
                    ariaLabel="Caption behavior"
                  />
                </fieldset>
                <label className="settings-select">
                  <span>Preferred language</span>
                  <select value={settings.captionLanguage} onChange={(event) => settingsStore.update({ captionLanguage: event.target.value as CaptionLanguage })}>
                    {CAPTION_LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
                  </select>
                </label>
                <fieldset className="settings-fieldset settings-fieldset-wide">
                  <legend>Caption size</legend>
                  <div className="caption-size-grid">
                    {CAPTION_SIZES.map((size) => <button key={size.value} type="button" className={settings.captionFontSize === size.value ? 'caption-size-active' : ''} aria-pressed={settings.captionFontSize === size.value} onClick={() => settingsStore.update({ captionFontSize: size.value })}>{size.label}</button>)}
                  </div>
                </fieldset>
              </div>
              <p className="settings-caption-note"><Icon name="info" /> Availability depends on caption tracks provided by YouTube; NightWatch does not scrape or generate subtitles.</p>
            </div>
          </section></>
        )}

        {section === 'social' && (
          <><SettingsHeader title="Social & privacy" description="Control device presence, friend visibility, and message filtering without exposing private room codes." /><section className="settings-grid"><ToggleCard title="Discord Rich Presence" description="Show what you are watching in Discord without exposing the room code." checked={settings.richPresenceEnabled} onChange={(richPresenceEnabled) => settingsStore.update({ richPresenceEnabled })} /><ToggleCard title="Message filter" description="Filter profanity in messages you send before everyone receives them." checked={settings.chatFilterEnabled} onChange={(chatFilterEnabled) => settingsStore.update({ chatFilterEnabled })} />{user !== null ? <PresencePrivacyCard /> : <div className="card settings-card settings-card-muted"><h2>Friend presence</h2><p>Connect Discord to choose whether accepted friends can see when you are online or watching.</p></div>}</section></>
        )}

        {section === 'accessibility' && (
          <><SettingsHeader title="Accessibility" description="Tune readability, motion, transparency, and keyboard focus for this device." /><section className="settings-grid settings-grid-two"><div className="card settings-card settings-card-wide text-scale-card"><div><h2>Text size</h2><p>Scale NightWatch interface text without changing the YouTube player.</p></div><RangeSetting label="Interface text" value={settings.textScalePercent} min={90} max={125} unit="%" onChange={(textScalePercent) => settingsStore.update({ textScalePercent })} /><div className="text-scale-preview" aria-label="Text size preview"><strong>Tonight is better together.</strong><span>Room details and messages stay clear at your chosen size.</span></div></div><ToggleCard title="Reduce motion" description="Minimize entrances, shimmer, hover movement, and reaction travel." checked={settings.reduceMotion} onChange={(reduceMotion) => settingsStore.update({ reduceMotion })} /><ToggleCard title="Higher contrast" description="Strengthen text, controls, and boundaries across every atmosphere." checked={settings.highContrast} onChange={(highContrast) => settingsStore.update({ highContrast })} /><ToggleCard title="Reduce transparency" description="Replace glass and translucent surfaces with solid backgrounds." checked={settings.reduceTransparency} onChange={(reduceTransparency) => settingsStore.update({ reduceTransparency })} /><ToggleCard title="Enhanced keyboard focus" description="Show a stronger focus ring when navigating controls with a keyboard." checked={settings.enhancedFocus} onChange={(enhancedFocus) => settingsStore.update({ enhancedFocus })} /><div className="card settings-card accessibility-note settings-card-wide" role="note"><Icon name="sparkle" /><div><h2>Player boundary</h2><p>These preferences change NightWatch surfaces only. Captions, playback controls, and accessibility options inside YouTube remain available through the official player.</p></div></div></section></>
        )}

        {section === 'account' && (
          <><SettingsHeader title="Account" description="Manage identity and authorized media connections without changing the embedded YouTube player session." /><section className="settings-grid"><div className="card settings-card account-card"><ProfileAvatar src={user?.avatarUrl ?? null} name={user?.name ?? 'Guest'} className="account-avatar" /><div><h2>{user?.name ?? 'Guest mode'}</h2><p>{user ? 'Connected with Discord' : 'Sign in to create and manage persistent rooms.'}</p></div><button type="button" className="button button-primary" onClick={() => void (user ? signOut() : signInWithDiscord())}>{user ? 'Sign out' : 'Connect Discord'}</button></div><div className="card settings-card account-integration-card"><span className="account-integration-icon"><Icon name="cloud" /></span><div><h2>Google Drive</h2><p>{driveAvailable ? 'Connect and choose authorized video files from the desktop Library. Every participant uses their own Google permission.' : 'Google Drive is available only in a configured Electron desktop build. It remains hidden in browser and Discord Activity.'}</p></div>{driveAvailable && onOpenLibrary !== undefined ? <button type="button" className="button button-primary" onClick={onOpenLibrary}><Icon name="library" size={16} />Open Library</button> : <span className="settings-sync-state">Desktop capability unavailable</span>}</div><div className="card settings-card settings-card-muted"><h2>YouTube account</h2><p>A separate read-only connection is being completed for subscriptions and account-owned discovery. It does not sign into, customize, or replace the embedded player session.</p></div></section></>
        )}

        {section === 'data' && (
          <><SettingsHeader title="Local data" description="NightWatch settings remain in local storage on this device." /><section className="settings-grid"><div className="card settings-card"><h2>Reset appearance</h2><p>Restore the default theme, accent, font, glow, radius, density, card surface, background artwork, custom atmosphere, and accessibility presentation.</p><ConfirmResetButton label="Reset appearance" confirmLabel="Confirm appearance reset" onConfirm={() => settingsStore.update({ theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent, uiFont: DEFAULT_SETTINGS.uiFont, accentGlowPercent: DEFAULT_SETTINGS.accentGlowPercent, cornerRadiusPx: DEFAULT_SETTINGS.cornerRadiusPx, density: DEFAULT_SETTINGS.density, backgroundStyle: DEFAULT_SETTINGS.backgroundStyle, cardStyle: DEFAULT_SETTINGS.cardStyle, customAtmosphere: DEFAULT_SETTINGS.customAtmosphere, customBackgroundImage: DEFAULT_SETTINGS.customBackgroundImage, customBackgroundEnabled: DEFAULT_SETTINGS.customBackgroundEnabled, profileBackgroundEnabled: DEFAULT_SETTINGS.profileBackgroundEnabled, reduceMotion: DEFAULT_SETTINGS.reduceMotion, highContrast: DEFAULT_SETTINGS.highContrast, textScalePercent: DEFAULT_SETTINGS.textScalePercent, reduceTransparency: DEFAULT_SETTINGS.reduceTransparency, enhancedFocus: DEFAULT_SETTINGS.enhancedFocus })} /></div><div className="card settings-card"><h2>Reset every setting</h2><p>Restore playback, browsing, social, and appearance preferences to NightWatch defaults.</p><ConfirmResetButton label="Reset all settings" confirmLabel="Confirm full reset" danger onConfirm={() => settingsStore.update(DEFAULT_SETTINGS)} /></div></section></>
        )}
      </div>
    </div>
  );
}

function SettingsHeader({ title, description }: { title: string; description: string }): JSX.Element { return <header className="settings-section-header"><span className="eyebrow">NightWatch preferences</span><h2>{title}</h2><p>{description}</p></header>; }
function RangeSetting({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange(value: number): void }): JSX.Element {
  const id = useId();
  const outputId = `${id}-output`;
  const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return <label className="range-setting" htmlFor={id}><span><span className="range-label">{label}</span><output id={outputId} htmlFor={id} aria-live="polite">{value}{unit}</output></span><input id={id} type="range" min={min} max={max} value={value} style={{ '--settings-range-progress': `${progress}%` } as CSSProperties} aria-describedby={outputId} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function ToggleCard({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange(value: boolean): void }): JSX.Element {
  const id = useId();
  const descriptionId = `${id}-description`;
  return <label className="card settings-card toggle-card" htmlFor={id}><span><strong>{title}</strong><small id={descriptionId}>{description}</small></span><input id={id} type="checkbox" checked={checked} aria-describedby={descriptionId} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-switch" aria-hidden="true" /></label>;
}

function ToggleLine({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange(value: boolean): void }): JSX.Element {
  const id = useId();
  return <label className={`custom-background-toggle${disabled ? ' custom-background-toggle-disabled' : ''}`} htmlFor={id}><span><strong>{title}</strong><small>{description}</small></span><input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-switch" aria-hidden="true" /></label>;
}

async function resizeBackgroundImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error('unsupported-background');
  }

  const source = await readFileAsDataUrl(file);
  const image = await loadBackgroundImage(source);
  const scale = Math.min(1, 1920 / image.naturalWidth, 1080 / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas-unavailable');
  context.drawImage(image, 0, 0, width, height);
  const result = canvas.toDataURL('image/webp', 0.82);
  if (result.length > 3_000_000) throw new Error('background-too-large');
  return result;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('background-read-failed'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('background-read-failed'));
    reader.readAsDataURL(file);
  });
}

function loadBackgroundImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('background-decode-failed'));
    image.onload = () => resolve(image);
    image.src = source;
  });
}

function Segmented<T extends string>({ values, active, labels, ariaLabel = 'Options', onSelect }: { values: readonly T[]; active: T; labels?: Partial<Record<T, string>>; ariaLabel?: string; onSelect(value: T): void }): JSX.Element { return <div className="segmented" role="group" aria-label={ariaLabel}>{values.map((value) => <button key={value} type="button" className={active === value ? 'segmented-active' : ''} onClick={() => onSelect(value)} aria-pressed={active === value}>{labels?.[value] ?? value}</button>)}</div>; }

function ConfirmResetButton({ label, confirmLabel, danger = false, onConfirm }: { label: string; confirmLabel: string; danger?: boolean; onConfirm(): void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return <div className="reset-confirmation">
    <button type="button" className={`button${danger || confirming ? ' button-danger' : ''}`} onClick={() => {
      if (!confirming) { setConfirming(true); return; }
      onConfirm();
      setConfirming(false);
    }}>{confirming ? confirmLabel : label}</button>
    {confirming && <button type="button" className="button" onClick={() => setConfirming(false)}>Cancel</button>}
  </div>;
}

function PresencePrivacyCard(): JSX.Element {
  const [preferences, setPreferences] = useState<PresencePreferences>({ shareOnline: false, shareActivity: false });
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    void getPresencePreferences().then((result) => {
      if (!active) return;
      if (result.status === 'ok') {
        setPreferences(result.data);
        setState('ready');
      } else {
        setState('error');
      }
    });
    return () => { active = false; };
  }, []);

  async function update(next: PresencePreferences): Promise<void> {
    setPreferences(next);
    setState('saving');
    const result = await setPresencePreferences(next);
    setState(result.status === 'ok' ? 'ready' : 'error');
  }

  return (
    <div className="card settings-card settings-card-wide presence-card">
      <div className="presence-card-heading"><div><h2>Friend presence</h2><p>Privacy-first: both options stay off until you choose to share with accepted friends.</p></div><span className={`settings-sync-state settings-sync-${state}`} role="status" aria-live="polite">{(state === 'loading' || state === 'saving') && <span className="settings-mini-loader" aria-hidden="true" />}{state === 'loading' ? 'Loading...' : state === 'saving' ? 'Saving...' : state === 'error' ? 'Could not save' : 'Private by default'}</span></div>
      <label className="privacy-option"><span><strong>Share online status</strong><small>Friends can see online, watching, or in-party. Your room code is never included.</small></span><input type="checkbox" checked={preferences.shareOnline} disabled={state === 'loading'} onChange={(event) => void update({ shareOnline: event.target.checked, shareActivity: event.target.checked ? preferences.shareActivity : false })} /><span className="toggle-switch" aria-hidden="true" /></label>
      <label className="privacy-option"><span><strong>Share watching activity</strong><small>Also show the current video title. Requires online status sharing.</small></span><input type="checkbox" checked={preferences.shareActivity} disabled={state === 'loading' || !preferences.shareOnline} onChange={(event) => void update({ ...preferences, shareActivity: event.target.checked })} /><span className="toggle-switch" aria-hidden="true" /></label>
    </div>
  );
}

function getCustomPaletteStatus(palette: { canvas: string; surface: string; panel: string }): { safe: boolean; message: string } {
  const textContrast = Math.min(
    contrastRatio('#f4f7ff', palette.canvas),
    contrastRatio('#f4f7ff', palette.surface),
    contrastRatio('#f4f7ff', palette.panel),
  );
  const structuralSeparation = Math.max(
    contrastRatio(palette.canvas, palette.surface),
    contrastRatio(palette.canvas, palette.panel),
    contrastRatio(palette.surface, palette.panel),
  );
  if (textContrast < 4.5) {
    return { safe: false, message: `Light text reaches only ${textContrast.toFixed(1)}:1 on one surface. Darken that colour for readable copy.` };
  }
  if (structuralSeparation < 1.18) {
    return { safe: false, message: 'The three surfaces are very similar. Increase their separation so cards and panels remain easy to scan.' };
  }
  return { safe: true, message: `Light text stays above ${textContrast.toFixed(1)}:1 and the structural layers remain distinct.` };
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (red ?? 0) * 0.2126 + (green ?? 0) * 0.7152 + (blue ?? 0) * 0.0722;
}
