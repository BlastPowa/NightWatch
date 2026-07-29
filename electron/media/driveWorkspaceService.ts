/**
 * Phase 37 â€” restricted Drive workspace operations.
 *
 * This service is main-process-only. It sees OAuth access tokens and local
 * paths while the renderer only receives sanitized metadata, opaque ids and
 * upload progress. It intentionally lists only the app-created workspace or
 * a folder the user selected through Google's Picker; it is not a Drive
 * browser and does not request a broader scope.
 */

import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { open, stat } from 'node:fs/promises';
import {
  isDriveId,
  isValidFolderName,
  normalizeListOptions,
  parseWorkspaceEntry,
  type DriveUploadProgress,
  type DriveWorkspaceEntry,
  type DriveWorkspaceFolder,
  type DriveWorkspacePage,
} from '@shared/driveWorkspaceContracts';
import { mediaFail, mediaOk, type MediaResult, type SupportedHtmlMediaMime } from '@shared/media';
import type { DriveWorkspaceInfo } from '@shared/mediaBridge';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const CHILD_PROPERTY = 'nightwatchWorkspaceChild';
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

type AccessTokenOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: 'consent-required' | 'revoked' | 'offline' | 'not-configured' };

export interface DriveWorkspaceServiceDeps {
  getAccessToken(): Promise<AccessTokenOutcome>;
  ensureWorkspace(): Promise<MediaResult<DriveWorkspaceInfo>>;
  fetchImpl?: typeof fetch;
  maxSizeBytes(): number;
  emitProgress(progress: DriveUploadProgress): void;
}

interface AuthorizedFolder {
  id: string;
  name: string;
  webViewLink: string;
}

interface DriveFileRecord {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  parents?: unknown;
  size?: unknown;
  modifiedTime?: unknown;
  thumbnailLink?: unknown;
  webViewLink?: unknown;
  capabilities?: { canDownload?: unknown };
}

function tokenFailure(reason: Exclude<AccessTokenOutcome, { ok: true }>['reason']): MediaResult<never> {
  switch (reason) {
    case 'consent-required':
      return mediaFail('auth-required', 'Connect Google Drive to use the shared workspace.');
    case 'revoked':
      return mediaFail('auth-expired', 'Google Drive access was revoked. Reconnect and try again.');
    case 'offline':
      return mediaFail('offline', 'Google Drive is unreachable right now.');
    case 'not-configured':
      return mediaFail('capability-disabled', 'Google Drive is not configured on this build.');
  }
}

function driveFailure(status: number, fallback: string): MediaResult<never> {
  if (status === 401) return mediaFail('auth-expired', 'Google Drive sign-in expired. Reconnect and try again.');
  if (status === 403) return mediaFail('permission-denied', 'Google Drive denied access to that workspace item.');
  if (status === 404) return mediaFail('drive-file-unavailable', 'That Drive item is no longer available to this account.');
  if (status === 429) return mediaFail('rate-limited', 'Google Drive is rate limiting requests. Try again shortly.');
  if (status >= 500) return mediaFail('offline', 'Google Drive is temporarily unavailable.');
  return mediaFail('internal', fallback);
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function mimeForPath(filePath: string): SupportedHtmlMediaMime | null {
  switch (extname(filePath).toLowerCase()) {
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    default: return null;
  }
}

function toFolder(record: DriveFileRecord): DriveWorkspaceFolder | null {
  return typeof record.id === 'string' && isDriveId(record.id) && typeof record.name === 'string'
    ? {
        id: record.id,
        name: record.name.slice(0, 200),
        webViewLink: typeof record.webViewLink === 'string' && record.webViewLink.startsWith('https://')
          ? record.webViewLink
          : '',
      }
    : null;
}

function toEntry(record: DriveFileRecord, parentId: string): DriveWorkspaceEntry | null {
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
  const kind = mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'video';
  if (kind === 'video' && mimeType !== 'video/mp4' && mimeType !== 'video/webm') return null;
  const rawSize = typeof record.size === 'string' ? Number(record.size) : record.size;
  return parseWorkspaceEntry({
    id: record.id,
    parentId,
    name: record.name,
    kind,
    mimeType,
    size: rawSize,
    modifiedAt: record.modifiedTime,
    thumbnailUrl: record.thumbnailLink,
    canDownload: record.capabilities?.canDownload === true,
  });
}

/** Main-process service backing the Phase 37 Drive workspace bridge. */
export class DriveWorkspaceService {
  private readonly fetchImpl: typeof fetch;
  private root: AuthorizedFolder | null = null;
  /** Folders discovered under an authorized root during this session. */
  private readonly knownFolders = new Map<string, AuthorizedFolder>();
  /** Explicit Picker selections. This set contains no local paths or tokens. */
  private readonly pickerFolders = new Map<string, AuthorizedFolder>();
  private readonly uploads = new Map<string, AbortController>();

  public constructor(private readonly deps: DriveWorkspaceServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async list(optionsValue: unknown): Promise<MediaResult<DriveWorkspacePage>> {
    const options = normalizeListOptions(optionsValue);
    const root = await this.getRoot();
    if (!root.ok) return root;
    const folder = options.folderId === undefined ? root.value : this.allowedFolder(options.folderId);
    if (folder === null) return mediaFail('permission-denied', 'Choose a folder from the NightWatch workspace first.');
    const token = await this.deps.getAccessToken();
    if (!token.ok) return tokenFailure(token.reason);
    const clauses = [`'${escapeDriveQuery(folder.id)}' in parents`, 'trashed=false'];
    if (options.nameContains !== undefined) clauses.push(`name contains '${escapeDriveQuery(options.nameContains)}'`);
    // URLSearchParams encodes query values exactly once. Pre-encoding here
    // would turn spaces into literal "%2520" and make Drive treat the whole
    // query as malformed text rather than a parents filter.
    const query = clauses.join(' and ');
    const params = new URLSearchParams({
      q: query,
      pageSize: String(options.pageSize ?? 50),
      fields: 'nextPageToken,files(id,name,mimeType,parents,size,modifiedTime,thumbnailLink,webViewLink,capabilities(canDownload))',
      orderBy: 'folder,name_natural',
    });
    if (options.pageToken !== undefined) params.set('pageToken', options.pageToken);
    try {
      const response = await this.fetchImpl(`${DRIVE_API}/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token.token}` },
      });
      if (!response.ok) return driveFailure(response.status, 'Could not list the Drive workspace.');
      const body = await response.json() as { files?: unknown; nextPageToken?: unknown };
      const entries = Array.isArray(body.files)
        ? body.files.map((file) => toEntry(file as DriveFileRecord, folder.id)).filter((entry): entry is DriveWorkspaceEntry => entry !== null)
        : [];
      for (const entry of entries) {
        if (entry.kind === 'folder') this.knownFolders.set(entry.id, { id: entry.id, name: entry.name, webViewLink: '' });
      }
      return mediaOk({
        folder,
        entries,
        nextPageToken: typeof body.nextPageToken === 'string' && body.nextPageToken.length <= 512 ? body.nextPageToken : null,
      });
    } catch {
      return mediaFail('offline', 'Google Drive is unreachable right now.');
    }
  }

  async createFolder(nameValue: unknown, parentIdValue: unknown): Promise<MediaResult<DriveWorkspaceFolder>> {
    if (!isValidFolderName(nameValue)) return mediaFail('invalid-request', 'Folder names must be 1–100 characters and cannot contain path separators.');
    const root = await this.getRoot();
    if (!root.ok) return root;
    const parent = typeof parentIdValue === 'string' ? this.allowedFolder(parentIdValue) : root.value;
    if (parent === null) return mediaFail('permission-denied', 'Choose a folder from the NightWatch workspace first.');
    const token = await this.deps.getAccessToken();
    if (!token.ok) return tokenFailure(token.reason);
    try {
      const response = await this.fetchImpl(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameValue.trim(),
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parent.id],
          appProperties: { [CHILD_PROPERTY]: 'v1' },
        }),
      });
      if (!response.ok) return driveFailure(response.status, 'Could not create the Drive folder.');
      const folder = toFolder(await response.json() as DriveFileRecord);
      if (folder === null) return mediaFail('internal', 'Google Drive returned an invalid folder.');
      this.knownFolders.set(folder.id, folder);
      return mediaOk(folder);
    } catch {
      return mediaFail('offline', 'Google Drive is unreachable right now.');
    }
  }

  /** Register an id returned by the explicit Picker after main validates it is a folder. */
  async authorizePickerFolder(folderId: string): Promise<MediaResult<DriveWorkspaceFolder>> {
    if (!isDriveId(folderId)) return mediaFail('invalid-request', 'That folder selection is invalid.');
    const token = await this.deps.getAccessToken();
    if (!token.ok) return tokenFailure(token.reason);
    try {
      const response = await this.fetchImpl(`${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,webViewLink`, {
        headers: { Authorization: `Bearer ${token.token}` },
      });
      if (!response.ok) return driveFailure(response.status, 'Could not authorize the selected Drive folder.');
      const payload = await response.json() as DriveFileRecord;
      if (payload.mimeType !== 'application/vnd.google-apps.folder') return mediaFail('invalid-selection', 'Select a Google Drive folder.');
      const folder = toFolder(payload);
      if (folder === null) return mediaFail('internal', 'Google Drive returned an invalid folder.');
      this.pickerFolders.set(folder.id, folder);
      return mediaOk(folder);
    } catch {
      return mediaFail('offline', 'Google Drive is unreachable right now.');
    }
  }

  async uploadFile(filePath: string, parentIdValue: unknown): Promise<MediaResult<{ uploadId: string }>> {
    const mimeType = mimeForPath(filePath);
    if (mimeType === null) return mediaFail('unsupported-format', 'Only MP4 and WebM video files can be uploaded.');
    const root = await this.getRoot();
    if (!root.ok) return root;
    const parent = typeof parentIdValue === 'string' ? this.allowedFolder(parentIdValue) : root.value;
    if (parent === null) return mediaFail('permission-denied', 'Choose a folder from the NightWatch workspace first.');
    let identity: Awaited<ReturnType<typeof stat>>;
    try { identity = await stat(filePath); } catch { return mediaFail('file-missing', 'The selected file is no longer available.'); }
    if (!identity.isFile() || identity.size <= 0 || identity.size > this.deps.maxSizeBytes()) {
      return mediaFail('invalid-selection', 'The selected file is empty or exceeds this build’s media limit.');
    }
    const token = await this.deps.getAccessToken();
    if (!token.ok) return tokenFailure(token.reason);
    const uploadId = randomBytes(16).toString('hex');
    const controller = new AbortController();
    this.uploads.set(uploadId, controller);
    this.deps.emitProgress({ uploadId, bytesSent: 0, totalBytes: identity.size, phase: 'preparing' });
    void this.runUpload(uploadId, controller, filePath, parent.id, mimeType, identity.size, token.token);
    return mediaOk({ uploadId });
  }

  cancelUpload(uploadId: unknown): void {
    if (typeof uploadId !== 'string' || !/^[0-9a-f]{32}$/.test(uploadId)) return;
    this.uploads.get(uploadId)?.abort();
  }

  private async runUpload(uploadId: string, controller: AbortController, filePath: string, parentId: string, mimeType: SupportedHtmlMediaMime, totalBytes: number, accessToken: string): Promise<void> {
    const emit = (bytesSent: number, phase: DriveUploadProgress['phase']): void => this.deps.emitProgress({ uploadId, bytesSent, totalBytes, phase });
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      const start = await this.fetchImpl(`${DRIVE_UPLOAD_API}?uploadType=resumable&fields=id,name`, {
        method: 'POST', signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(totalBytes),
        },
        body: JSON.stringify({ name: filePath.split(/[\\/]/).pop()?.slice(0, 300) ?? 'NightWatch video', mimeType, parents: [parentId] }),
      });
      if (!start.ok) throw new Error(`http:${String(start.status)}`);
      const sessionUrl = start.headers.get('location');
      if (sessionUrl === null || !sessionUrl.startsWith('https://www.googleapis.com/')) throw new Error('no-session');
      handle = await open(filePath, 'r');
      let offset = 0;
      while (offset < totalBytes) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const length = Math.min(UPLOAD_CHUNK_BYTES, totalBytes - offset);
        const buffer = Buffer.allocUnsafe(length);
        const read = await handle.read(buffer, 0, length, offset);
        if (read.bytesRead !== length) throw new Error('file-changed');
        const end = offset + length - 1;
        const response = await this.fetchImpl(sessionUrl, {
          method: 'PUT', signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Length': String(length), 'Content-Range': `bytes ${String(offset)}-${String(end)}/${String(totalBytes)}` },
          body: buffer,
        });
        if (!(response.status === 308 || response.ok)) throw new Error(`http:${String(response.status)}`);
        offset += length;
        emit(offset, offset === totalBytes ? 'finalizing' : 'uploading');
      }
      emit(totalBytes, 'done');
    } catch (error) {
      emit(0, controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError') ? 'cancelled' : 'failed');
    } finally {
      await handle?.close().catch(() => {});
      this.uploads.delete(uploadId);
    }
  }

  private async getRoot(): Promise<MediaResult<AuthorizedFolder>> {
    const workspace = await this.deps.ensureWorkspace();
    if (!workspace.ok) return workspace;
    if (this.root?.id !== workspace.value.folderId) {
      this.root = { id: workspace.value.folderId, name: workspace.value.name, webViewLink: workspace.value.webViewLink };
      this.knownFolders.clear();
    }
    return mediaOk(this.root);
  }

  private allowedFolder(id: string): AuthorizedFolder | null {
    if (!isDriveId(id)) return null;
    if (this.root?.id === id) return this.root;
    return this.knownFolders.get(id) ?? this.pickerFolders.get(id) ?? null;
  }
}
