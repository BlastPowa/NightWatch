import { useEffect, useState } from 'react';
import type { AppInfo, UpdateStatusMessage } from '@shared/ipc';
import changelog from '../../CHANGELOG.md?raw';
import { BrandMark } from '@/components/BrandMark';
import { Icon } from '@/components/Icon';
import '@/styles/phase27-secondary.css';

const STATUS_TEXT: Record<UpdateStatusMessage['state'], string> = {
  dev: 'Updates only work in the installed app.',
  checking: 'Checking for updates...',
  available: 'Update found - downloading...',
  downloading: 'Downloading update...',
  downloaded: 'Update ready - restart to apply.',
  'up-to-date': 'You are on the latest version.',
  error: 'Update check failed.',
};

/** About NightWatch: version, patch notes, manual update check (ADR-016). */
export function AboutScreen(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatusMessage | null>(null);

  const inElectron = typeof window.nightwatch !== 'undefined';

  useEffect(() => {
    if (!inElectron) {
      return;
    }
    window.nightwatch.getAppInfo().then(setAppInfo).catch(() => {});
    return window.nightwatch.onUpdateStatus(setStatus);
  }, [inElectron]);

  function handleCheck(): void {
    if (inElectron) {
      setStatus({ state: 'checking' });
      window.nightwatch.checkForUpdates().catch(() => setStatus({ state: 'error' }));
    }
  }

  function handleInstall(): void {
    if (inElectron) {
      window.nightwatch.installUpdate().catch(() => {});
    }
  }

  return (
    <div className="settings-page about-page p27-about-page fade-up">
      <section className="card p27-about-hero">
        <div className="p27-about-glow" aria-hidden="true" />
        <div className="about-header p27-about-identity">
          <span className="p27-about-mark-wrap"><BrandMark className="about-mark" /></span>
          <div>
            <span className="eyebrow">NightWatch desktop</span>
            <h1 className="page-title">Watch together, stay in sync.</h1>
            <p className="user-sub p27-about-version">
              {appInfo !== null
                ? `Version ${appInfo.version} | Electron ${appInfo.electronVersion} | ${appInfo.platform}`
                : inElectron ? 'Loading version information...' : 'Version information is available in the installed app'}
            </p>
          </div>
        </div>

        <div className="about-update p27-about-update">
          <button
            type="button"
            className="button button-primary p27-update-button"
            onClick={handleCheck}
            disabled={!inElectron || status?.state === 'checking' || status?.state === 'downloading'}
            title={inElectron ? 'Check GitHub Releases for a newer NightWatch build' : 'Available in the installed desktop app'}
          >
            <Icon name="sparkle" /> Check for updates
          </button>
          {status !== null && (
            <span className={`p27-update-state p27-update-${status.state}`} role="status" aria-live="polite">
              {STATUS_TEXT[status.state]}
              {status.state === 'downloading' && status.percent !== undefined
                ? ` ${status.percent}%`
                : ''}
              {status.state === 'error' && status.message !== undefined
                ? ` (${status.message})`
                : ''}
            </span>
          )}
          {status?.state === 'downloaded' && (
            <button type="button" className="button button-glow" onClick={handleInstall}>
              Restart &amp; Update
            </button>
          )}
        </div>
      </section>

      <section className="p27-about-facts" aria-label="NightWatch product principles">
        <article className="card"><Icon name="friends" /><div><strong>Made for company</strong><span>Rooms, reactions, chat, and shared queues keep everyone on the same beat.</span></div></article>
        <article className="card"><Icon name="play" /><div><strong>Official playback</strong><span>YouTube remains inside its official player while NightWatch synchronizes state around it.</span></div></article>
        <article className="card"><Icon name="lock" /><div><strong>Privacy by design</strong><span>Local preferences stay on this device and presence sharing remains under your control.</span></div></article>
      </section>

      <section className="card settings-card p27-changelog-card">
        <header><div><span className="eyebrow">Release journal</span><h2 className="settings-heading">What's new</h2></div><span className="p27-release-pill">Current build</span></header>
        <pre className="changelog">{changelog}</pre>
      </section>
    </div>
  );
}
