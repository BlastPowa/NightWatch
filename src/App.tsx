import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    window.nightwatch
      .getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setAppInfo(info);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBridgeError('IPC bridge unavailable');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1 className="shell-title">NightWatch</h1>
      <p className="shell-subtitle">Watch together. Perfectly in sync.</p>
      <footer className="shell-footer">
        {bridgeError !== null && <span className="shell-meta">{bridgeError}</span>}
        {appInfo !== null && (
          <span className="shell-meta">
            v{appInfo.version} · Electron {appInfo.electronVersion} · {appInfo.platform}
          </span>
        )}
      </footer>
    </main>
  );
}
