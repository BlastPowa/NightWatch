/**
 * YouTube account connection (Settings → Account).
 *
 * This is the feature the Settings card described as "planned separately
 * after Google OAuth, secure token storage, consent, revocation, and scope
 * review" — all of which now exist from the Phase 29 Drive work, and all of
 * which this reuses: the same system-browser PKCE flow, the same encrypted
 * safeStorage token store (its own credential file), the same serialized
 * refresh session.
 *
 * Scope is `youtube.readonly` and nothing else: the connection reads the
 * user's channel identity and library data; it can never post, rate, or
 * change anything. It is also entirely separate from the embedded player —
 * NightWatch never signs into or alters the iframe session, which keeps its
 * own cookies in the renderer and is never touched from here.
 */

import { shell } from 'electron';
import { mediaFail, mediaOk, normalizeMediaTitle, type MediaResult } from '@shared/media';
import type { YouTubeAccountState } from '@shared/mediaBridge';
import {
  LoopbackAuthListener,
  YOUTUBE_READONLY_SCOPE,
  revokeToken,
  runInteractiveGoogleAuth,
  type FetchLike,
  type OAuthClientConfig,
} from './driveAuth';
import { DriveSession } from './driveClient';
import type { DriveTokenStore } from './tokenStore';

export interface YouTubeAccountDeps {
  fetchFn: FetchLike;
  config: OAuthClientConfig;
  /** Its own credential file — never shared with the Drive connection. */
  tokenStore: DriveTokenStore;
  openExternal?: (url: string) => Promise<void>;
}

export function disconnectedYouTubeState(
  reason: YouTubeAccountState['reason'] = null,
): YouTubeAccountState {
  return { connected: false, channelTitle: null, reason };
}

export class YouTubeAccountManager {
  private readonly session: DriveSession;
  private activeAuth: LoopbackAuthListener | null = null;

  constructor(private readonly deps: YouTubeAccountDeps) {
    this.session = new DriveSession(deps.fetchFn, deps.config, deps.tokenStore);
  }

  async getState(): Promise<YouTubeAccountState> {
    const stored = await this.deps.tokenStore.read();
    if (stored.status === 'unavailable') {
      return disconnectedYouTubeState('token-store-unavailable');
    }
    if (stored.status === 'absent') {
      return disconnectedYouTubeState();
    }
    // accountEmail doubles as the display label; for YouTube it holds the
    // channel title captured at connect time.
    return { connected: true, channelTitle: stored.accountEmail, reason: null };
  }

  /** Interactive connect. A cancelled attempt leaves a prior connection intact. */
  async connect(): Promise<MediaResult<YouTubeAccountState>> {
    if (this.activeAuth !== null) {
      return mediaFail('invalid-request', 'A Google sign-in is already in progress.');
    }
    try {
      const grant = await runInteractiveGoogleAuth({
        fetchFn: this.deps.fetchFn,
        config: this.deps.config,
        scope: YOUTUBE_READONLY_SCOPE,
        openExternal: this.deps.openExternal ?? ((url: string) => shell.openExternal(url)),
        onListener: (listener) => {
          this.activeAuth = listener;
        },
      });
      if (!grant.ok) {
        return grant;
      }

      const channelTitle = await this.lookupChannelTitle(grant.value.accessToken);
      const written = await this.deps.tokenStore.write(grant.value.refreshToken, channelTitle);
      if (written === 'unavailable') {
        await revokeToken(this.deps.fetchFn, grant.value.refreshToken);
        return mediaFail(
          'token-store-unavailable',
          'This device cannot store the YouTube sign-in securely, so it stays disconnected.',
        );
      }
      if (written === 'failed') {
        await revokeToken(this.deps.fetchFn, grant.value.refreshToken);
        return mediaFail('internal', 'The YouTube sign-in could not be saved.');
      }

      this.session.adopt(grant.value.accessToken, grant.value.expiresInSeconds);
      return mediaOk({ connected: true, channelTitle, reason: null });
    } finally {
      this.activeAuth = null;
    }
  }

  abortAuth(): void {
    this.activeAuth?.abort();
    this.activeAuth = null;
  }

  /** Best-effort revocation, then unconditional local deletion. */
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
   * The connected channel's title, for the settings card. Display only —
   * run through the same title normalization as everything user-visible,
   * because a channel name is attacker-adjacent text like any other.
   */
  private async lookupChannelTitle(accessToken: string): Promise<string | null> {
    try {
      const response = await this.deps.fetchFn(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&fields=items(snippet(title))',
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as {
        items?: Array<{ snippet?: { title?: unknown } }>;
      };
      const title = payload.items?.[0]?.snippet?.title;
      return typeof title === 'string' ? normalizeMediaTitle(title) : null;
    } catch {
      return null;
    }
  }
}
