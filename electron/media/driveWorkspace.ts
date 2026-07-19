import { mediaFail, mediaOk, type MediaResult } from '@shared/media';

/**
 * Phase 32 — Google Drive shared workspace (handoff §2).
 *
 * Creates or reuses ONE app-created "NightWatch Shared" folder, tagged with
 * an appProperties marker so we find our own folder rather than trusting a
 * name. Sharing the folder/files happens through Google's own permission
 * surface (the returned webViewLink opens Drive's sharing UI); NightWatch
 * never proxies bytes, never stores tokens outside safeStorage, and never
 * promises that a host's upload auto-grants viewers — each viewer proves
 * their own access (per-viewer probeFileAccess).
 *
 * Dependency-injected so tests exercise revoked/expired/permission paths
 * without the network: the token provider is the Phase 29 DriveSession's
 * getAccessToken, and fetch is the global by default.
 */

export interface DriveWorkspaceInfo {
  folderId: string;
  name: string;
  /** Google Drive web link — opened in the SYSTEM browser for sharing. */
  webViewLink: string;
}

export type DriveFileAccessState =
  | 'accessible'
  | 'permission-required'
  | 'revoked'
  | 'not-found'
  | 'offline';

export interface DriveWorkspaceDeps {
  /** Phase 29 token outcome: token string, or a typed refusal. */
  getAccessToken(): Promise<
    | { ok: true; token: string }
    | { ok: false; reason: 'consent-required' | 'revoked' | 'offline' | 'not-configured' }
  >;
  fetchImpl?: typeof fetch;
}

const WORKSPACE_NAME = 'NightWatch Shared';
const APP_PROPERTY_KEY = 'nightwatchWorkspace';
const APP_PROPERTY_VALUE = 'shared-v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function tokenFailure(
  reason: 'consent-required' | 'revoked' | 'offline' | 'not-configured',
): MediaResult<never> {
  switch (reason) {
    case 'consent-required':
      return mediaFail('auth-required', 'Connect Google Drive to use the shared workspace.');
    case 'revoked':
      return mediaFail('auth-expired', 'Google Drive access was revoked — reconnect.');
    case 'offline':
      return mediaFail('offline', 'Google Drive is unreachable right now.');
    case 'not-configured':
      return mediaFail('capability-disabled', 'Google Drive is not configured on this build.');
  }
}

export class DriveWorkspace {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly deps: DriveWorkspaceDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /** Find-or-create the app-tagged workspace folder. */
  public async ensureWorkspace(): Promise<MediaResult<DriveWorkspaceInfo>> {
    const token = await this.deps.getAccessToken();
    if (!token.ok) {
      return tokenFailure(token.reason);
    }

    try {
      // 1. Find our folder by app property — never by name alone.
      const query = encodeURIComponent(
        `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' } ` +
          `and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      );
      const found = await this.fetchImpl(
        `${DRIVE_API}/files?q=${query}&fields=files(id,name,webViewLink)&pageSize=1`,
        { headers: { Authorization: `Bearer ${token.token}` } },
      );
      if (found.status === 401) {
        return mediaFail('auth-expired', 'Google Drive session expired — reconnect.');
      }
      if (found.status === 403) {
        return mediaFail('permission-denied', 'Google Drive refused the workspace lookup.');
      }
      if (!found.ok) {
        return mediaFail('internal', 'Google Drive workspace lookup failed.');
      }
      const foundBody = (await found.json()) as {
        files?: Array<{ id?: string; name?: string; webViewLink?: string }>;
      };
      const existing = foundBody.files?.[0];
      if (existing?.id !== undefined) {
        return mediaOk({
          folderId: existing.id,
          name: existing.name ?? WORKSPACE_NAME,
          webViewLink: existing.webViewLink ?? '',
        });
      }

      // 2. Create it (drive.file scope covers app-created files).
      const created = await this.fetchImpl(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: WORKSPACE_NAME,
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE },
        }),
      });
      if (created.status === 401) {
        return mediaFail('auth-expired', 'Google Drive session expired — reconnect.');
      }
      if (created.status === 403) {
        return mediaFail('permission-denied', 'Google Drive refused workspace creation.');
      }
      if (!created.ok) {
        return mediaFail('internal', 'Could not create the shared workspace folder.');
      }
      const createdBody = (await created.json()) as {
        id?: string;
        name?: string;
        webViewLink?: string;
      };
      if (createdBody.id === undefined) {
        return mediaFail('internal', 'Workspace creation returned no folder id.');
      }
      return mediaOk({
        folderId: createdBody.id,
        name: createdBody.name ?? WORKSPACE_NAME,
        webViewLink: createdBody.webViewLink ?? '',
      });
    } catch {
      return mediaFail('offline', 'Google Drive is unreachable right now.');
    }
  }

  /**
   * Per-viewer access probe for one file id (handoff §2: every participant
   * independently proves access). Distinguishes "you can stream this" from
   * every state the viewer can act on.
   */
  public async probeFileAccess(fileId: string): Promise<DriveFileAccessState> {
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(fileId)) {
      return 'not-found';
    }
    const token = await this.deps.getAccessToken();
    if (!token.ok) {
      switch (token.reason) {
        case 'offline':
          return 'offline';
        case 'revoked':
          return 'revoked';
        default:
          return 'permission-required';
      }
    }
    try {
      const response = await this.fetchImpl(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,capabilities(canDownload)`,
        { headers: { Authorization: `Bearer ${token.token}` } },
      );
      if (response.status === 401) {
        return 'revoked';
      }
      if (response.status === 403 || response.status === 404) {
        // Drive reports both "no permission" and "hidden from you" as 404
        // for non-shared files; either way the viewer must request access.
        return 'permission-required';
      }
      if (!response.ok) {
        return 'offline';
      }
      const body = (await response.json()) as {
        capabilities?: { canDownload?: boolean };
      };
      return body.capabilities?.canDownload === true
        ? 'accessible'
        : 'permission-required';
    } catch {
      return 'offline';
    }
  }
}
