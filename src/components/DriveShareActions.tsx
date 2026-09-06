import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { copyPlainText } from '@/lib/clipboard';

const DRIVE_HOME_URL = 'https://drive.google.com/drive/my-drive';
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

export function driveFileUrl(fileId: string): string | null {
  return DRIVE_FILE_ID.test(fileId)
    ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
    : null;
}

interface DriveShareActionsProps {
  fileId?: string | null;
  mode?: 'host' | 'viewer' | 'library';
  compact?: boolean;
}

export function DriveShareActions({
  fileId = null,
  mode = 'library',
  compact = false,
}: DriveShareActionsProps): JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const fileUrl = fileId === null ? null : driveFileUrl(fileId);

  async function copyLink(): Promise<void> {
    if (fileUrl === null) {
      return;
    }
    const copied = await copyPlainText(fileUrl);
    setCopyState(copied ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1800);
  }

  return (
    <div className={`drive-share-actions${compact ? ' drive-share-actions-compact' : ''}`}>
      {fileUrl !== null && (
        <>
          <a
            className="button button-primary"
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="cloud" size={16} />
            {mode === 'viewer' ? 'Open shared file' : 'Open file in Drive'}
          </a>
          <button type="button" className="button" onClick={() => void copyLink()}>
            <Icon name={copyState === 'copied' ? 'check' : 'send'} size={16} />
            {copyState === 'copied'
              ? 'Link copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy share link'}
          </button>
          {mode !== 'viewer' && (
            <a
              className="button button-quiet"
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the file in Google Drive, then use Drive's Share control."
            >
              <Icon name="users" size={16} />
              Manage sharing
            </a>
          )}
        </>
      )}
      <a
        className="button button-quiet"
        href={DRIVE_HOME_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="library" size={16} />
        Open My Drive
      </a>
    </div>
  );
}

export function DriveRoomGuide({ role }: { role: 'host' | 'viewer' }): JSX.Element {
  return (
    <ol className="drive-room-guide">
      {role === 'host' ? (
        <>
          <li>Select the Drive video in NightWatch.</li>
          <li>Open it in Drive and share it with each viewer, or choose Drive link access.</li>
          <li>Copy the link into your invite message and wait for everyone to show Ready.</li>
        </>
      ) : (
        <>
          <li>Open the host&apos;s shared file and accept or request Google permission.</li>
          <li>Connect the same Google account in NightWatch.</li>
          <li>Authorize the shared file with Google Picker, then retry readiness.</li>
        </>
      )}
    </ol>
  );
}
