import { describe, expect, it } from 'vitest';
import {
  clampPageSize,
  DRIVE_PAGE_SIZE_DEFAULT,
  DRIVE_PAGE_SIZE_MAX,
  isDriveId,
  isDrivePageToken,
  isSafeThumbnailUrl,
  isValidFolderName,
  normalizeListOptions,
  parseWorkspaceEntry,
  parseWorkspacePage,
} from './driveWorkspaceContracts';

const ID = 'a'.repeat(20);
const PARENT = 'b'.repeat(20);

const ENTRY = {
  id: ID,
  parentId: PARENT,
  name: 'Movie Night.mp4',
  kind: 'video',
  mimeType: 'video/mp4',
  size: 1024,
  modifiedAt: '2026-07-20T10:00:00.000Z',
  thumbnailUrl: 'https://lh3.googleusercontent.com/thumb',
  canDownload: true,
};

describe('id and token validation', () => {
  it('accepts Drive-shaped ids and rejects path-like values', () => {
    expect(isDriveId(ID)).toBe(true);
    expect(isDriveId('../../etc/passwd')).toBe(false);
    expect(isDriveId('short')).toBe(false);
    expect(isDriveId(42)).toBe(false);
  });

  it('accepts opaque page tokens and rejects injection-shaped ones', () => {
    expect(isDrivePageToken('~!!~AI9FV7Ab-c_d.e=')).toBe(false); // '!' not allowed
    expect(isDrivePageToken('AI9FV7Ab-c_d.e=')).toBe(true);
    expect(isDrivePageToken('token with space')).toBe(false);
    expect(isDrivePageToken('x'.repeat(600))).toBe(false);
  });
});

describe('clampPageSize', () => {
  it('defaults, floors, and caps', () => {
    expect(clampPageSize(undefined)).toBe(DRIVE_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(Number.NaN)).toBe(DRIVE_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(10.9)).toBe(10);
    expect(clampPageSize(10_000)).toBe(DRIVE_PAGE_SIZE_MAX);
  });
});

describe('normalizeListOptions', () => {
  it('drops malformed ids and tokens instead of forwarding them', () => {
    const options = normalizeListOptions({
      folderId: '../secret',
      pageToken: 'has space',
      pageSize: 25,
      nameContains: '  holiday  ',
    });
    expect(options.folderId).toBeUndefined();
    expect(options.pageToken).toBeUndefined();
    expect(options.pageSize).toBe(25);
    expect(options.nameContains).toBe('holiday');
  });

  it('keeps valid values and bounds the name filter', () => {
    const options = normalizeListOptions({
      folderId: ID,
      pageToken: 'AI9FV7Ab',
      nameContains: 'x'.repeat(500),
    });
    expect(options.folderId).toBe(ID);
    expect(options.pageToken).toBe('AI9FV7Ab');
    expect(options.nameContains).toHaveLength(200);
  });

  it('tolerates a non-object payload from the bridge', () => {
    expect(normalizeListOptions(null).pageSize).toBe(DRIVE_PAGE_SIZE_DEFAULT);
  });
});

describe('isValidFolderName', () => {
  it('accepts labels and rejects path separators and controls', () => {
    expect(isValidFolderName('Movie Nights')).toBe(true);
    expect(isValidFolderName('  ')).toBe(false);
    expect(isValidFolderName('a/b')).toBe(false);
    expect(isValidFolderName('a\\b')).toBe(false);
    expect(isValidFolderName('bad\u0000name')).toBe(false);
    expect(isValidFolderName('x'.repeat(101))).toBe(false);
  });
});

describe('isSafeThumbnailUrl', () => {
  it('allows only Google-hosted https images', () => {
    expect(isSafeThumbnailUrl('https://lh3.googleusercontent.com/x')).toBe(true);
    expect(isSafeThumbnailUrl('https://drive.google.com/thumb')).toBe(true);
    expect(isSafeThumbnailUrl('http://lh3.googleusercontent.com/x')).toBe(false);
    expect(isSafeThumbnailUrl('https://evil.example/x')).toBe(false);
    expect(isSafeThumbnailUrl('file:///C:/secret.png')).toBe(false);
    expect(isSafeThumbnailUrl('not a url')).toBe(false);
  });
});

describe('parseWorkspaceEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(parseWorkspaceEntry(ENTRY)?.id).toBe(ID);
  });

  it('nulls an unsafe thumbnail rather than rejecting the row', () => {
    const entry = parseWorkspaceEntry({ ...ENTRY, thumbnailUrl: 'https://evil.example/x' });
    expect(entry?.thumbnailUrl).toBeNull();
  });

  it('treats a missing or invalid size as unknown', () => {
    expect(parseWorkspaceEntry({ ...ENTRY, size: undefined })?.size).toBeNull();
    expect(parseWorkspaceEntry({ ...ENTRY, size: -5 })?.size).toBeNull();
  });

  it('defaults canDownload to false when absent', () => {
    expect(parseWorkspaceEntry({ ...ENTRY, canDownload: undefined })?.canDownload).toBe(false);
  });

  it('rejects bad ids, kinds, and timestamps', () => {
    expect(parseWorkspaceEntry({ ...ENTRY, id: 'nope' })).toBeNull();
    expect(parseWorkspaceEntry({ ...ENTRY, kind: 'document' })).toBeNull();
    expect(parseWorkspaceEntry({ ...ENTRY, modifiedAt: 'never' })).toBeNull();
    expect(parseWorkspaceEntry(null)).toBeNull();
  });
});

describe('parseWorkspacePage', () => {
  const PAGE = {
    folder: { id: PARENT, name: 'NightWatch Shared', webViewLink: 'https://drive.google.com/x' },
    entries: [ENTRY, { ...ENTRY, id: 'bad' }],
    nextPageToken: 'AI9FV7Ab',
  };

  it('keeps valid entries and drops invalid ones', () => {
    const page = parseWorkspacePage(PAGE);
    expect(page?.entries).toHaveLength(1);
    expect(page?.nextPageToken).toBe('AI9FV7Ab');
  });

  it('blanks a non-https folder link', () => {
    const page = parseWorkspacePage({
      ...PAGE,
      folder: { ...PAGE.folder, webViewLink: 'javascript:alert(1)' },
    });
    expect(page?.folder.webViewLink).toBe('');
  });

  it('nulls an invalid continuation token', () => {
    expect(parseWorkspacePage({ ...PAGE, nextPageToken: 'has space' })?.nextPageToken).toBeNull();
  });

  it('rejects a page without a valid folder', () => {
    expect(parseWorkspacePage({ ...PAGE, folder: { id: 'x' } })).toBeNull();
    expect(parseWorkspacePage(null)).toBeNull();
  });
});
