/**
 * Phase 29 — Drive orchestration: connect, pick, disconnect.
 *
 * Composes the auth flow (driveAuth), the encrypted token store (tokenStore),
 * the session (driveClient), and the isolated Picker (drivePicker) behind the
 * same MediaResult surface everything else uses. All Electron-facing
 * dependencies are injected so the orchestration is testable.
 */

import { shell } from 'electron';
import {
  mediaFail,
  mediaOk,
  type HtmlMediaSourceDescriptor,
  type MediaResult,
} from '@shared/media';
import { disconnectedDriveState, type DriveConnectionState, type SelectedMedia } from '@shared/mediaBridge';
import {
  LoopbackAuthListener,
  buildAuthUrl,
  exchangeCodeForTokens,
  generatePkceVerifier,
  generateState,
  isAllowedAuthUrl,
  pkceChallengeFor,
  revokeToken,
  type FetchLike,
  type OAuthClientConfig,
} from './driveAuth';
import {
  DriveSession,
  fetchDriveMetadata,
  streamDriveRange,
  type AccessTokenOutcome,
} from './driveClient';
import { pickDriveFileId, type PickerHost } from './drivePicker';
import type { DriveTokenStore } from './tokenStore';

export interface DriveManagerDeps {
  fetchFn: FetchLike;
  config: OAuthClientConfig;
  pickerApiKey: string;
  appId: string;
  tokenStore: DriveTokenStore;
  maxSizeBytes: () => number;
  openExternal?: (url: string) => Promise<void>;
  showPicker?: typeof pickDriveFileId;
}

function authOutcomeToFailure(outcome: Exclude<AccessTokenOutcome, { status: 'ok' }>): MediaResult<never> {
  switch (outcome.status) {
    case 'auth-required':
      return mediaFail('auth-required', 'Connect Google Drive to continue.');
    case 'auth-expired':
      return mediaFail('auth-expired', 'Your Google Drive sign-in has expired. Reconnect to continue.');
    case 'token-store-unavailable':
      return mediaFail(
        'token-store-unavailable',
        'This device cannot store the Drive sign-in securely, so Drive stays disconnected.',
      );
    case 'offline':
      return mediaFail('offline', 'Google Drive could not be reached.');
  }
}

export class DriveManager {
  private readonly session: DriveSession;
  /** One outstanding interactive authorization at a time. */
  private activeAuth: LoopbackAuthListener | null = null;

  constructor(private readonly deps: DriveManagerDeps) {
    this.session = new DriveSession(deps.fetchFn, deps.config, deps.tokenStore);
  }

  async getConnectionState(): Promise<DriveConnectionState> {
    const stored = await this.deps.tokenStore.read();
    if (stored.status === 'unavailable') {
      return disconnectedDriveState('token-store-unavailable');
    }
    if (stored.status === 'absent') {
      return disconnectedDriveState();
    }
    return { connected: true, accountEmail: stored.accountEmail, reason: null };
  }

  /**
   * Interactive connect: system browser, PKCE, loopback.
   *
   * A cancelled attempt leaves any previous valid connection untouched — the
   * stored token is only replaced after a successful exchange.
   */
  async connect(): Promise<MediaResult<DriveConnectionState>> {
    if (this.activeAuth !== null) {
      // One at a time. A second click while the browser is open is a
      // cancellation of the second click, not the first attempt.
      return mediaFail('invalid-request', 'A Google sign-in is already in progress.');
    }

    const listener = new LoopbackAuthListener();
    this.activeAuth = listener;
    try {
      const redirectUri = await listener.listen();

      const verifier = generatePkceVerifier();
      const state = generateState();
      const authUrl = buildAuthUrl({
        clientId: this.deps.config.clientId,
        redirectUri,
        challenge: pkceChallengeFor(verifier),
        state,
        // Offline access is requested here, when establishing the stored
        // connection, and nowhere else.
        offline: true,
      });

      // Belt and braces: the URL was just built against the Google origin,
      // and it is still checked before anything reaches the system browser.
      if (!isAllowedAuthUrl(authUrl)) {
        return mediaFail('internal', 'The sign-in address failed validation.');
      }
      const openExternal = this.deps.openExternal ?? ((url: string) => shell.openExternal(url));
      await openExternal(authUrl);

      const callback = await listener.waitForCallback(state);
      if (!callback.ok) {
        return callback;
      }

      const exchanged = await exchangeCodeForTokens(
        this.deps.fetchFn,
        this.deps.config,
        callback.value.code,
        verifier,
        redirectUri,
      );
      if (exchanged.status !== 'ok') {
        return exchanged.status === 'offline'
          ? mediaFail('offline', 'Google could not be reached to finish signing in.')
          : mediaFail('auth-cancelled', 'Google sign-in could not be completed.');
      }
      if (exchanged.tokens.refreshToken === null) {
        return mediaFail('auth-cancelled', 'Google did not grant offline access. Try connecting again.');
      }

      const email = await this.lookupAccountEmail(exchanged.tokens.accessToken);
      const written = await this.deps.tokenStore.write(exchanged.tokens.refreshToken, email);
      if (written === 'unavailable') {
        return mediaFail(
          'token-store-unavailable',
          'This device cannot store the Drive sign-in securely, so Drive stays disconnected.',
        );
      }
      if (written === 'failed') {
        return mediaFail('internal', 'The Drive sign-in could not be saved.');
      }

      this.session.adopt(exchanged.tokens.accessToken, exchanged.tokens.expiresInSeconds);
      return mediaOk({ connected: true, accountEmail: email, reason: null });
    } catch {
      return mediaFail('internal', 'Google sign-in could not be started.');
    } finally {
      // Via the local, not this.activeAuth: abortAuth() may have nulled the
      // field while this attempt was still unwinding.
      listener.abort();
      if (this.activeAuth === listener) {
        this.activeAuth = null;
      }
    }
  }

  /** Abort an in-flight interactive sign-in (app exit). */
  abortAuth(): void {
    this.activeAuth?.abort();
    this.activeAuth = null;
  }

  /**
   * Best-effort revocation, then unconditional local cleanup. The user asked
   * to disconnect; being offline does not get to veto that.
   */
  async disconnect(): Promise<MediaResult<void>> {
    const stored = await this.deps.tokenStore.read();
    if (stored.status === 'ok') {
      await revokeToken(this.deps.fetchFn, stored.refreshToken);
    }
    await this.deps.tokenStore.clear();
    this.session.invalidate();
    return mediaOk(undefined);
  }

  /**
   * Show the isolated Picker, then re-fetch and validate metadata in main.
   * Picker metadata is never trusted — only the file id survives, and even
   * that is just a lookup key for our own validated files.get.
   */
  async pickFile(host: PickerHost): Promise<MediaResult<SelectedMedia>> {
    const token = await this.session.getAccessToken();
    if (token.status !== 'ok') {
      return authOutcomeToFailure(token);
    }

    const showPicker = this.deps.showPicker ?? pickDriveFileId;
    const picked = await showPicker(host, {
      accessToken: token.accessToken,
      pickerApiKey: this.deps.pickerApiKey,
      appId: this.deps.appId,
    });
    if (!picked.ok) {
      return picked;
    }

    const metadata = await fetchDriveMetadata(
      this.deps.fetchFn,
      token.accessToken,
      picked.value,
      this.deps.maxSizeBytes(),
    );
    if (!metadata.ok) {
      return metadata;
    }

    return mediaOk({
      descriptor: {
        schemaVersion: 1,
        kind: 'drive',
        fileId: metadata.value.fileId,
        fingerprint: metadata.value.fingerprint,
        title: metadata.value.title,
        mimeType: metadata.value.mimeType,
        size: metadata.value.size,
      },
      // Drive selections have no device-local file; the fileId is the handle.
      localHandle: metadata.value.fileId,
    });
  }

  /**
   * Revalidate before leasing: permission and download restrictions are
   * re-checked with the participant's OWN token, per the handoff. A file id
   * in a room event proves nothing.
   */
  async validateForLease(
    descriptor: Extract<HtmlMediaSourceDescriptor, { kind: 'drive' }>,
  ): Promise<MediaResult<void>> {
    const token = await this.session.getAccessToken();
    if (token.status !== 'ok') {
      return authOutcomeToFailure(token);
    }
    const metadata = await fetchDriveMetadata(
      this.deps.fetchFn,
      token.accessToken,
      descriptor.fileId,
      this.deps.maxSizeBytes(),
    );
    if (!metadata.ok) {
      return metadata;
    }
    if (
      metadata.value.fingerprint !== descriptor.fingerprint ||
      metadata.value.size !== descriptor.size
    ) {
      // The file behind this id no longer matches what the room agreed on.
      return mediaFail('source-mismatch', 'This Drive file does not match the one being watched.');
    }
    return mediaOk(undefined);
  }

  /** Stream one ranged read with a fresh token. 404 on any auth problem. */
  async streamRange(
    fileId: string,
    rangeHeader: string | null,
    mimeType: 'video/mp4' | 'video/webm',
  ): Promise<Response> {
    const token = await this.session.getAccessToken();
    if (token.status !== 'ok') {
      return new Response(null, { status: 404 });
    }
    return streamDriveRange(this.deps.fetchFn, token.accessToken, { fileId, rangeHeader }, mimeType);
  }

  /** Display email via Drive's own about endpoint; drive.file covers it. */
  private async lookupAccountEmail(accessToken: string): Promise<string | null> {
    try {
      const response = await this.deps.fetchFn(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as { user?: { emailAddress?: unknown } };
      const email = payload.user?.emailAddress;
      return typeof email === 'string' && email.length > 0 && email.length <= 320 ? email : null;
    } catch {
      return null;
    }
  }
}
