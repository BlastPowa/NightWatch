import { useEffect, useState } from 'react';
import type { AppInfo, UpdateStatusMessage } from '@shared/ipc';
import changelog from '../../CHANGELOG.md?raw';
import { BrandMark } from '@/components/BrandMark';

const STATUS_TEXT: Record<UpdateStatusMessage['state'], string> = {
  dev: 'Updates only work in the installed app.',
  checking: 'Checking for updates…',
  available: 'Update found — downloading…',
  downloading: 'Downloading update…',
  downloaded: 'Update ready — restart to apply.',
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
    <div className="settings-page fade-up">
      <h1 className="page-title">About NightWatch</h1>

      <section className="card settings-card">
        <div className="about-header">
          <BrandMark className="about-mark" />
          <div>
            <p className="user-name">NightWatch</p>
            <p className="user-sub">
              {appInfo !== null
                ? `Version ${appInfo.version} · Electron ${appInfo.electronVersion} · ${appInfo.platform}`
                : 'Version information unavailable outside Electron'}
            </p>
          </div>
        </div>

        <div className="about-update">
          <button
            type="button"
            className="button button-primary"
            onClick={handleCheck}
            disabled={status?.state === 'checking' || status?.state === 'downloading'}
          >
            Check for Updates
          </button>
          {status !== null && (
            <span className="user-sub">
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

      <section className="card settings-card">
        <h2 className="settings-heading">Patch notes</h2>
        <pre className="changelog">{changelog}</pre>
      </section>
    </div>
  );
}
