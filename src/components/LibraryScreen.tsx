import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaCapabilities, MediaFailure } from '@shared/media';
import type {
  DriveConnectionState,
  DriveWorkspaceInfo,
  FingerprintProgress,
  MediaPlatformBridge,
  PlaybackLease,
  SelectedMedia,
} from '@shared/mediaBridge';
import type { DriveUploadProgress, DriveWorkspaceEntry, DriveWorkspacePage } from '@shared/driveWorkspaceContracts';
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
  const [driveWorkspace, setDriveWorkspace] = useState<DriveWorkspaceInfo | null>(null);
  const [workspacePage, setWorkspacePage] = useState<DriveWorkspacePage | null>(null);
  const [workspaceTrail, setWorkspaceTrail] = useState<DriveWorkspaceInfo[]>([]);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [upload, setUpload] = useState<DriveUploadProgress | null>(null);
  const [busy, setBusy] = useState<'local' | 'drive-connect' | 'drive-pick' | 'drive-workspace' | null>(null);
  const [progress, setProgress] = useState<FingerprintProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshDrive = useCallback(async (): Promise<void> => {
    if (!capabilities.googleDrive) {
      setDrive(null);
      return;
    }
    const state = await bridge.getDriveConnection();
    setDrive(state);
  }, [bridge, capabilities.googleDrive]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    void refreshDrive();
    const onFocus = (): void => { void refreshDrive(); };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshDrive();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshDrive]);

  useEffect(() => {
    return bridge.onFingerprintProgress((next) => {
      setProgress(next);
    });
  }, [bridge]);

  useEffect(() => bridge.onDriveWorkspaceUploadProgress((next) => {
    setUpload(next);
    if (next.phase === 'done') {
      setMessage('Upload complete. Refresh the workspace to see the video.');
    }
    if (next.phase === 'failed') {
      setMessage('The Drive upload did not complete. Check your connection and try again.');
    }
  }), [bridge]);

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
      setMessage(result.value.connected
        ? `Google Drive connected${result.value.accountEmail ? ` as ${result.value.accountEmail}` : ''}.`
        : 'Google authorization returned, but no Drive credential was stored. Try connecting again.');
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

  async function cancelDriveConnect(): Promise<void> {
    await bridge.cancelDriveConnect();
    setBusy(null);
    setMessage('Google Drive connection cancelled.');
  }

  async function ensureDriveWorkspace(open = false): Promise<void> {
    setBusy('drive-workspace');
    setMessage(null);
    try {
      const result = open ? await bridge.openDriveWorkspace() : await bridge.ensureDriveWorkspace();
      if (!result.ok) {
        setMessage(failureMessage(result.error));
        return;
      }
      setDriveWorkspace(result.value);
      if (!open) await loadWorkspace();
      setMessage(open
        ? 'The NightWatch Shared folder opened in Google Drive. Use Drive sharing to invite viewers.'
        : 'NightWatch Shared is ready. Open it to upload files and manage viewer permissions.');
    } finally {
      setBusy(null);
    }
  }

  async function loadWorkspace(folderId?: string, options?: { resetTrail?: boolean; pageToken?: string }): Promise<void> {
    setBusy('drive-workspace');
    setMessage(null);
    try {
      const result = await bridge.listDriveWorkspace({
        folderId,
        pageToken: options?.pageToken,
        pageSize: 50,
        nameContains: workspaceSearch.trim() || undefined,
      });
      if (!result.ok) {
        setMessage(failureMessage(result.error));
        return;
      }
      setWorkspacePage(result.value);
      const root = {
        folderId: result.value.folder.id,
        name: result.value.folder.name,
        webViewLink: result.value.folder.webViewLink,
      };
      setDriveWorkspace(root);
      setWorkspaceTrail((current) => {
        if (options?.resetTrail || current.length === 0) return [root];
        if (current.at(-1)?.folderId === root.folderId) return current;
        return [...current, root];
      });
    } finally {
      setBusy(null);
    }
  }

  async function createWorkspaceFolder(): Promise<void> {
    const name = window.prompt('Name this Drive folder');
    if (name === null || name.trim() === '') return;
    setBusy('drive-workspace');
    setMessage(null);
    try {
      const result = await bridge.createDriveWorkspaceFolder(name, workspacePage?.folder.id);
      if (!result.ok) {
        setMessage(failureMessage(result.error));
        return;
      }
      setMessage(`Created ${result.value.name}.`);
      await loadWorkspace(workspacePage?.folder.id);
    } finally {
      setBusy(null);
    }
  }

  async function authorizeWorkspaceFolder(): Promise<void> {
    setBusy('drive-workspace');
    setMessage(null);
    try {
      const result = await bridge.authorizeDriveWorkspaceFolder();
      if (!result.ok) {
        if (result.error.code !== 'cancelled') setMessage(failureMessage(result.error));
        return;
      }
      setMessage(`${result.value.name} is now available in NightWatch.`);
      await loadWorkspace(result.value.id, { resetTrail: true });
    } finally {
      setBusy(null);
    }
  }

  async function uploadWorkspaceVideo(): Promise<void> {
    setMessage(null);
    setUpload(null);
    const result = await bridge.uploadDriveWorkspaceFile(workspacePage?.folder.id);
    if (!result.ok) {
      if (result.error.code !== 'cancelled') setMessage(failureMessage(result.error));
      return;
    }
    setUpload({ uploadId: result.value.uploadId, bytesSent: 0, totalBytes: 1, phase: 'preparing' });
  }

  async function openWorkspaceEntry(entry: DriveWorkspaceEntry): Promise<void> {
    if (entry.kind === 'folder') {
      await loadWorkspace(entry.id);
      return;
    }
    setBusy('drive-pick');
    setMessage('Choose this authorized file in Google Picker to create a private playback lease.');
    try {
      const selected = await bridge.pickDriveFile();
      if (selected.ok) await prepare(selected.value);
      else if (selected.error.code !== 'cancelled') setMessage(failureMessage(selected.error));
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreWorkspace(): Promise<void> {
    if (workspacePage?.nextPageToken === null || workspacePage === null) return;
    await loadWorkspace(workspacePage.folder.id, { pageToken: workspacePage.nextPageToken });
  }

  async function copyWorkspaceLink(): Promise<void> {
    if (driveWorkspace === null) return;
    await navigator.clipboard.writeText(driveWorkspace.webViewLink);
    setMessage('Drive folder link copied. Google Drive permission is still required for every viewer.');
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
            ) : drive === null ? (
              <div className="library-drive-status" role="status"><span className="loader-orbit" /><div><strong>Checking Google Drive</strong><span>Reading the encrypted connection state from this device…</span></div></div>
            ) : drive.connected ? (
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
              <button type="button" className="button button-primary library-action" disabled={busy !== null && busy !== 'drive-connect'} onClick={() => void (busy === 'drive-connect' ? cancelDriveConnect() : connectDrive())}>
                <Icon name={busy === 'drive-connect' ? 'close' : 'cloud'} />
                {busy === 'drive-connect' ? 'Cancel connection' : 'Connect Google Drive'}
              </button>
            )}
          </article>
        )}
      </div>

      {drive?.connected && (
        <section className="drive-workspace card" aria-labelledby="drive-workspace-title">
          <header>
            <div><span className="eyebrow">Connected account</span><h2 id="drive-workspace-title">Drive movie workspace</h2><p>Use an app-created folder or one you explicitly authorize with Google Picker. Google sharing decides who can view each video.</p></div>
            <span className="library-account"><Icon name="check" />{drive.accountEmail ?? 'Drive connected'}</span>
          </header>
          <div className="drive-workspace-steps">
            <span><b>1</b><small>Create or open the NightWatch Shared folder.</small></span>
            <span><b>2</b><small>Upload a supported MP4/WebM and grant every viewer access.</small></span>
            <span><b>3</b><small>Each viewer connects Drive and authorizes the same file before synchronized playback.</small></span>
          </div>
          <div className="drive-workspace-actions">
            <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void ensureDriveWorkspace()}><Icon name="cloud" size={16} />{driveWorkspace === null ? 'Create shared folder' : 'Open workspace'}</button>
            <button type="button" className="button" disabled={busy !== null} onClick={() => void authorizeWorkspaceFolder()}><Icon name="plus" size={16} />Authorize shared folder</button>
            {driveWorkspace !== null && <button type="button" className="button" onClick={() => void copyWorkspaceLink()}><Icon name="send" size={16} />Copy folder link</button>}
            <button type="button" className="button" disabled={busy !== null} onClick={() => void ensureDriveWorkspace(true)}><Icon name="compass" size={16} />Open in Drive</button>
          </div>
          {driveWorkspace !== null && <p className="drive-workspace-link"><Icon name="lock" size={14} /><span>{driveWorkspace.name}</span><small>Google remains the permission authority; having the link alone never bypasses access.</small></p>}

          {workspacePage !== null && (
            <div className="drive-browser" aria-label="NightWatch Drive workspace">
              <div className="drive-browser-toolbar">
                <nav className="drive-breadcrumbs" aria-label="Current Drive folder">
                  {workspaceTrail.map((folder, index) => (
                    <button key={folder.folderId} type="button" className="button-link" onClick={() => void loadWorkspace(folder.folderId, { resetTrail: index === 0 })}>
                      {folder.name}{index < workspaceTrail.length - 1 ? ' /' : ''}
                    </button>
                  ))}
                </nav>
                <label className="drive-browser-search"><Icon name="search" size={15} /><input value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadWorkspace(workspacePage.folder.id, { resetTrail: true }); }} placeholder="Filter this folder" aria-label="Filter Drive workspace" /></label>
              </div>
              <div className="drive-browser-actions">
                <button type="button" className="button" disabled={busy !== null} onClick={() => void loadWorkspace(workspacePage.folder.id, { resetTrail: true })}><Icon name="refresh" size={15} />Refresh</button>
                <button type="button" className="button" disabled={busy !== null} onClick={() => void createWorkspaceFolder()}><Icon name="plus" size={15} />New folder</button>
                <button type="button" className="button button-primary" disabled={upload !== null} onClick={() => void uploadWorkspaceVideo()}><Icon name="upload" size={15} />Upload video</button>
              </div>
              {upload !== null && (
                <div className="drive-upload-progress" role="status">
                  <div><strong>{upload.phase === 'done' ? 'Upload complete' : `Upload ${upload.phase}`}</strong><span>{upload.totalBytes > 1 ? `${Math.round((upload.bytesSent / upload.totalBytes) * 100)}%` : 'Preparingâ€¦'}</span></div>
                  <progress value={upload.bytesSent} max={upload.totalBytes} />
                  {upload.phase !== 'done' && <button type="button" className="button button-quiet" onClick={() => void bridge.cancelDriveWorkspaceUpload(upload.uploadId)}><Icon name="close" size={14} />Cancel</button>}
                </div>
              )}
              <div className="drive-entry-grid">
                {workspacePage.entries.length === 0 ? <p className="drive-browser-empty">This authorized folder has no supported videos yet. Upload an MP4/WebM or add one using Google Picker.</p> : workspacePage.entries.map((entry) => (
                  <button key={entry.id} type="button" className="drive-entry" onClick={() => void openWorkspaceEntry(entry)}>
                    <span className="drive-entry-art">{entry.thumbnailUrl !== null ? <img src={entry.thumbnailUrl ?? undefined} alt="" /> : <Icon name={entry.kind === 'folder' ? 'library' : 'film'} size={25} />}</span>
                    <span className="drive-entry-copy"><strong>{entry.name}</strong><small>{entry.kind === 'folder' ? 'Folder' : `${entry.canDownload ? 'Ready to authorize' : 'Permission required'} Â· ${entry.size === null ? 'Size unavailable' : formatBytes(entry.size)}`}</small></span>
                    <Icon name={entry.kind === 'folder' ? 'chevron-right' : 'play'} size={16} />
                  </button>
                ))}
              </div>
              {workspacePage.nextPageToken !== null && <button type="button" className="button drive-load-more" disabled={busy !== null} onClick={() => void loadMoreWorkspace()}>Load more</button>}
            </div>
          )}
        </section>
      )}

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
