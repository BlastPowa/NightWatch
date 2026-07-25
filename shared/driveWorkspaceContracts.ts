/**
 * Phase 34 — typed Google Drive workspace contracts consumed by Phase 37.
 *
 * Scope discipline (unchanged and non-negotiable): `drive.file` only. Every
 * item reachable through these contracts is either app-created or explicitly
 * authorized by the user through the Google Picker. There is no folder tree
 * walk, no `drive.readonly`, and no full-Drive browsing.
 *
 * Boundary discipline: OAuth/refresh tokens, Authorization headers, raw Drive
 * API responses, and filesystem paths never cross into the renderer. What
 * crosses is an opaque `id`, display metadata, and a bounded thumbnail URL.
 *
 * Pure module — types plus validation only, so main, preload, renderer, and
 * tests can all import it.
 */

/** An item inside the NightWatch workspace the renderer may display. */
export interface DriveWorkspaceEntry {
  /** Opaque Drive file id. Useless without the viewer's own authorization. */
  id: string;
  parentId: string;
  name: string;
  kind: 'folder' | 'video';
  mimeType: string;
  /** Bytes; null for folders and for items Drive does not report a size for. */
  size: number | null;
  /** RFC 3339 timestamp string as Drive reports it. */
  modifiedAt: string;
  /** Google-hosted thumbnail, or null. Never a local path. */
  thumbnailUrl: string | null;
  /** False when the viewer may see the item but not stream it. */
  canDownload: boolean;
}

/** The app-created workspace folder (shape aligned with mediaBridge). */
export interface DriveWorkspaceFolder {
  id: string;
  name: string;
  webViewLink: string;
}

/** One page of a folder listing. */
export interface DriveWorkspacePage {
  folder: DriveWorkspaceFolder;
  entries: DriveWorkspaceEntry[];
  /** Opaque Drive continuation token, or null at the end of the listing. */
  nextPageToken: string | null;
}

/** Upload progress for a resumable workspace upload (Phase 37 uses this). */
export interface DriveUploadProgress {
  /** Correlates progress to one upload; not derived from the file. */
  uploadId: string;
  bytesSent: number;
  totalBytes: number;
  phase: 'preparing' | 'uploading' | 'finalizing' | 'done' | 'cancelled' | 'failed';
}

/** Listing request options. Deliberately no free-form query path. */
export interface DriveListOptions {
  /** Folder to list. Omit for the workspace root. */
  folderId?: string;
  /** Drive continuation token from a previous page. */
  pageToken?: string;
  /** 1–100; the platform clamps out-of-range values. */
  pageSize?: number;
  /**
   * Name filter, matched by Drive server-side within the authorized folder.
   * Never logged — it is user text (see safeDiagnostics).
   */
  nameContains?: string;
}

export const DRIVE_PAGE_SIZE_DEFAULT = 50;
export const DRIVE_PAGE_SIZE_MAX = 100;
export const DRIVE_NAME_MAX_LENGTH = 200;

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_~=\-.]{1,512}$/;

export function isDriveId(value: unknown): value is string {
  return typeof value === 'string' && DRIVE_ID_PATTERN.test(value);
}

export function isDrivePageToken(value: unknown): value is string {
  return typeof value === 'string' && PAGE_TOKEN_PATTERN.test(value);
}

/** Clamp a requested page size into the supported range. */
export function clampPageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DRIVE_PAGE_SIZE_DEFAULT;
  }
  return Math.min(DRIVE_PAGE_SIZE_MAX, Math.max(1, Math.floor(value)));
}

/**
 * Normalize listing options at the IPC boundary. Invalid ids/tokens are
 * dropped rather than forwarded — a malformed id reaching Drive is how a
 * "list my workspace" call turns into something else.
 */
export function normalizeListOptions(value: unknown): DriveListOptions {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const options: DriveListOptions = { pageSize: clampPageSize(record['pageSize']) };
  if (isDriveId(record['folderId'])) {
    options.folderId = record['folderId'];
  }
  if (isDrivePageToken(record['pageToken'])) {
    options.pageToken = record['pageToken'];
  }
  const nameContains = record['nameContains'];
  if (typeof nameContains === 'string' && nameContains.trim().length > 0) {
    options.nameContains = nameContains.trim().slice(0, DRIVE_NAME_MAX_LENGTH);
  }
  return options;
}

/** Folder names the user may create inside the workspace. */
export function isValidFolderName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    return false;
  }
  // Control characters and path separators are rejected: a name is a label,
  // never a path, and a name that renders as a path invites confusion.
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1F\x7F/\\]/.test(trimmed);
}

/** Only Google-hosted image hosts may appear as a thumbnail. */
export function isSafeThumbnailUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname.endsWith('.googleusercontent.com') ||
        url.hostname.endsWith('.google.com') ||
        url.hostname === 'drive.google.com')
    );
  } catch {
    return false;
  }
}

/**
 * Validate a workspace entry crossing the bridge.
 *
 * Returns null instead of a partially-trusted entry: a malformed entry in a
 * list is a rendering bug at best and a spoofed row at worst.
 */
export function parseWorkspaceEntry(value: unknown): DriveWorkspaceEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = record['id'];
  const parentId = record['parentId'];
  const name = record['name'];
  const kind = record['kind'];
  const mimeType = record['mimeType'];
  const modifiedAt = record['modifiedAt'];

  if (
    !isDriveId(id) ||
    !isDriveId(parentId) ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > DRIVE_NAME_MAX_LENGTH ||
    (kind !== 'folder' && kind !== 'video') ||
    typeof mimeType !== 'string' ||
    mimeType.length === 0 ||
    mimeType.length > 100 ||
    typeof modifiedAt !== 'string' ||
    Number.isNaN(Date.parse(modifiedAt))
  ) {
    return null;
  }

  const rawSize = record['size'];
  const size =
    typeof rawSize === 'number' && Number.isSafeInteger(rawSize) && rawSize >= 0
      ? rawSize
      : null;

  return {
    id,
    parentId,
    name,
    kind,
    mimeType,
    size,
    modifiedAt,
    thumbnailUrl: isSafeThumbnailUrl(record['thumbnailUrl'])
      ? (record['thumbnailUrl'] as string)
      : null,
    canDownload: record['canDownload'] === true,
  };
}

/** Validate a page, dropping any entry that fails validation. */
export function parseWorkspacePage(value: unknown): DriveWorkspacePage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const folderRaw = record['folder'];
  if (typeof folderRaw !== 'object' || folderRaw === null) {
    return null;
  }
  const folder = folderRaw as Record<string, unknown>;
  if (
    !isDriveId(folder['id']) ||
    typeof folder['name'] !== 'string' ||
    typeof folder['webViewLink'] !== 'string'
  ) {
    return null;
  }
  const entriesRaw = Array.isArray(record['entries']) ? record['entries'] : [];
  const entries = entriesRaw
    .map(parseWorkspaceEntry)
    .filter((entry): entry is DriveWorkspaceEntry => entry !== null);

  return {
    folder: {
      id: folder['id'],
      name: (folder['name'] as string).slice(0, DRIVE_NAME_MAX_LENGTH),
      webViewLink: (folder['webViewLink'] as string).startsWith('https://')
        ? (folder['webViewLink'] as string)
        : '',
    },
    entries,
    nextPageToken: isDrivePageToken(record['nextPageToken'])
      ? (record['nextPageToken'] as string)
      : null,
  };
}

/**
 * The workspace surface the Electron media bridge will expose (Phase 37
 * wires the UI; Phase 34 fixes the shape so the frontend can be written
 * against it). Upload is resumable and cancellable because a large video on
 * a domestic connection WILL be interrupted.
 */
export interface DriveWorkspaceBridge {
  listWorkspace(options?: DriveListOptions): Promise<DriveWorkspacePage>;
  createWorkspaceFolder(name: string, parentId?: string): Promise<DriveWorkspaceFolder | null>;
  /** Re-check that this device still holds authorization for a folder. */
  authorizeWorkspaceFolder(folderId: string): Promise<boolean>;
  /** Start a resumable upload of a locally selected file. */
  startWorkspaceUpload(localHandle: string, parentId?: string): Promise<string>;
  cancelWorkspaceUpload(uploadId: string): Promise<void>;
  onUploadProgress(callback: (progress: DriveUploadProgress) => void): () => void;
  /** Open the workspace (or an item) in the SYSTEM browser. */
  openInDrive(id: string): Promise<void>;
}
