import { useEffect, useRef, useState } from 'react';
import type { MediaCapabilities, MediaFailure } from '@shared/media';
import type {
  DriveConnectionState,
  FingerprintProgress,
  MediaPlatformBridge,
  PlaybackLease,
  SelectedMedia,
} from '@shared/mediaBridge';
import { Icon } from '@/components/Icon';

interface LibraryScreenProps {
  bridge: MediaPlatformBridge;
  capabilities: MediaCapabilities;
}

interface ActiveMedia {
  selected: SelectedMedia;
  lease: PlaybackLease;
}

export function LibraryScreen({ bridge, capabilities }: LibraryScreenProps): JSX.Element {
  const [active, setActive] = useState<ActiveMedia | null>(null);
  const activeRef = useRef<ActiveMedia | null>(null);
  const [drive, setDrive] = useState<DriveConnectionState | null>(null);
  const [busy, setBusy] = useState<'local' | 'drive-connect' | 'drive-pick' | null>(null);
  const [progress, setProgress] = useState<FingerprintProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!capabilities.googleDrive) {
      setDrive(null);
      return;
    }
    let cancelled = false;
    void bridge.getDriveConnection().then((state) => {
      if (!cancelled) setDrive(state);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, capabilities.googleDrive]);

  useEffect(() => {
    return bridge.onFingerprintProgress((next) => {
      setProgress(next);
    });
  }, [bridge]);

  useEffect(() => {
    return () => {
      const current = activeRef.current;
      if (current !== null) {
        void bridge.releasePlaybackLease(current.lease.leaseId);
      }
    };
  }, [bridge]);

  async function prepare(selected: SelectedMedia): Promise<void> {
    const support = document.createElement('video').canPlayType(selected.descriptor.mimeType);
    if (support === '') {
      setMessage('This device cannot decode the selected video format.');
      return;
    }

    const current = activeRef.current;
    if (current !== null) {
      await bridge.releasePlaybackLease(current.lease.leaseId);
      activeRef.current = null;
      setActive(null);
    }

    const lease = await bridge.createPlaybackLease(selected.descriptor);
    if (!lease.ok) {
      setMessage(failureMessage(lease.error));
      return;
    }
    const next = { selected, lease: lease.value };
    activeRef.current = next;
    setActive(next);
    setMessage(null);
  }

  async function chooseLocal(): Promise<void> {
    setBusy('local');
    setMessage(null);
    setProgress(null);
    try {
      const selected = await bridge.pickLocalFile();
      if (!selected.ok) {
        if (selected.error.code !== 'cancelled') setMessage(failureMessage(selected.error));
        return;
      }
      await prepare(selected.value);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function connectDrive(): Promise<void> {
    setBusy('drive-connect');
    setMessage(null);
    try {
      const result = await bridge.connectDrive();
      if (!result.ok) {
        if (result.error.code !== 'auth-cancelled' && result.error.code !== 'cancelled') {
          setMessage(failureMessage(result.error));
        }
        return;
      }
      setDrive(result.value);
    } finally {
      setBusy(null);
    }
  }

  async function chooseDrive(): Promise<void> {
    setBusy('drive-pick');
    setMessage(null);
    try {
      const selected = await bridge.pickDriveFile();
      if (!selected.ok) {
        if (selected.error.code !== 'cancelled') setMessage(failureMessage(selected.error));
        return;
      }
      await prepare(selected.value);
    } finally {
      setBusy(null);
    }
  }

  async function disconnectDrive(): Promise<void> {
    const result = await bridge.disconnectDrive();
    if (!result.ok) {
      setMessage(failureMessage(result.error));
      return;
    }
    if (activeRef.current?.selected.descriptor.kind === 'drive') {
      await bridge.releasePlaybackLease(activeRef.current.lease.leaseId);
      activeRef.current = null;
      setActive(null);
    }
    setDrive({ connected: false, accountEmail: null, reason: null });
  }

  function cancelFingerprint(): void {
    if (progress !== null) {
      void bridge.cancelFingerprint(progress.operationId);
    }
  }

  return (
    <section className="library-page fade-up">
      <header className="library-hero">
        <div>
          <span className="eyebrow">Authorized media</span>
          <h1>Your Library</h1>
          <p>Play a video you own from this computer or your private Google Drive. NightWatch never relays the file to other people.</p>
        </div>
        <div className="library-security-note">
          <Icon name="lock" />
          <span>Paths, tokens, and playback leases stay on this device.</span>
        </div>
      </header>

      {message !== null && <div className="library-message" role="alert">{message}</div>}

      <div className="library-source-grid">
        {capabilities.localFiles && (
          <article className="library-source-card">
            <div className="library-source-icon"><Icon name="film" size={24} /></div>
            <div>
              <span className="eyebrow">This computer</span>
              <h2>Local video</h2>
              <p>Select an MP4 or WebM file. NightWatch fingerprints it so another participant can match their own authorized copy later.</p>
            </div>
            {progress !== null ? (
              <div className="library-progress">
                <div className="library-progress-copy">
                  <span>Preparing video</span>
                  <strong>{Math.round((progress.bytesHashed / progress.totalBytes) * 100)}%</strong>
                </div>
                <progress value={progress.bytesHashed} max={progress.totalBytes} />
                <button type="button" className="button" onClick={cancelFingerprint}>
                  <Icon name="close" size={15} />
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="button button-primary library-action" disabled={busy !== null} onClick={() => void chooseLocal()}>
                <Icon name="plus" />
                {busy === 'local' ? 'Preparing…' : 'Choose local video'}
              </button>
            )}
          </article>
        )}

        {capabilities.reasons.googleDrive !== 'unsupported-platform' && (
          <article className={`library-source-card library-drive-card${capabilities.googleDrive ? '' : ' library-source-card-muted'}`}>
            <div className="library-source-icon"><Icon name="cloud" size={24} /></div>
            <div>
              <span className="eyebrow">Private cloud</span>
              <h2>Google Drive</h2>
              <p>NightWatch requests access only to files you choose. Every participant uses their own Google authorization.</p>
            </div>
            <DrivePrivacyChecklist />
            {!capabilities.googleDrive ? (
              <div className="library-drive-status" role="status">
                <Icon name={capabilities.reasons.googleDrive === 'not-configured' ? 'settings' : 'shield'} />
                <div>
                  <strong>
                    {capabilities.reasons.googleDrive === 'not-configured'
                      ? 'Google configuration incomplete'
                      : 'Drive disabled in this build'}
                  </strong>
                  <span>
                    {capabilities.reasons.googleDrive === 'not-configured'
                      ? 'The desktop OAuth client, restricted Picker key, or app ID is missing from this packaged build.'
                      : 'The owner-controlled Drive capability is off. Local playback remains private and available.'}
                  </span>
                </div>
              </div>
            ) : drive?.connected ? (
              <div className="library-drive-actions">
                <span className="library-account"><Icon name="check" />{drive.accountEmail ?? 'Drive connected'}</span>
                <button type="button" className="button button-primary library-action" disabled={busy !== null} onClick={() => void chooseDrive()}>
                  <Icon name="plus" />
                  {busy === 'drive-pick' ? 'Opening…' : 'Choose Drive video'}
                </button>
                <button type="button" className="button button-quiet" onClick={() => void disconnectDrive()}>
                  <Icon name="close" size={15} />
                  Disconnect
                </button>
              </div>
            ) : (
              <button type="button" className="button button-primary library-action" disabled={busy !== null} onClick={() => void connectDrive()}>
                <Icon name="cloud" />
                {busy === 'drive-connect' ? 'Connecting…' : 'Connect Google Drive'}
              </button>
            )}
          </article>
        )}
      </div>

      <section className="library-player-card">
        {active === null ? (
          <div className="library-empty">
            <span className="library-empty-icon"><Icon name="play" size={30} /></span>
            <h2>No video selected</h2>
            <p>Choose an authorized source above to preview it on this device.</p>
          </div>
        ) : (
          <>
            <div className="library-player-stage">
              <video
                key={active.lease.playbackUrl}
                src={active.lease.playbackUrl}
                controls
                preload="metadata"
                onError={() => setMessage('The selected video could not be played on this device.')}
              />
            </div>
            <div className="library-now-playing">
              <div>
                <span className="eyebrow">{active.selected.descriptor.kind === 'drive' ? 'Google Drive' : 'This computer'}</span>
                <h2>{active.selected.descriptor.title}</h2>
                <p>{formatBytes(active.selected.descriptor.size)} · {active.selected.descriptor.mimeType}</p>
              </div>
              <span className="library-private-badge"><Icon name="lock" size={14} />Private preview</span>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function DrivePrivacyChecklist(): JSX.Element {
  return (
    <ul className="library-drive-checklist" aria-label="Google Drive privacy safeguards">
      <li><Icon name="compass" size={15} /><span>Google sign-in opens in your system browser.</span></li>
      <li><Icon name="library" size={15} /><span>Picker grants access only to files you select.</span></li>
      <li><Icon name="lock" size={15} /><span>Refresh tokens are encrypted with Electron safeStorage.</span></li>
      <li><Icon name="users" size={15} /><span>Every viewer must have permission to the same file.</span></li>
    </ul>
  );
}

function failureMessage(failure: MediaFailure): string {
  return failure.message || 'The media request could not be completed.';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
