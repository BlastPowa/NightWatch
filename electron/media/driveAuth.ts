/**
 * Phase 29 — Google OAuth for installed desktop apps (PKCE + loopback).
 *
 * The flow, per Google's native-app guidance:
 *
 *   1. Generate a fresh PKCE verifier and S256 challenge, plus a random state.
 *   2. Start a listener on a random 127.0.0.1 port. Loopback only — never
 *      out-of-band copy/paste, which trains users to paste codes into apps.
 *   3. Open the authorization URL in the SYSTEM browser. The user signs in
 *      where their password manager and session already live; NightWatch never
 *      sees the credentials.
 *   4. Receive the redirect, verify the state, exchange the code.
 *
 * The scope is `drive.file` and nothing else: NightWatch can see only files
 * the user explicitly picks. A desktop OAuth client's secret is not
 * confidential (it ships in the binary) and is treated accordingly — it gates
 * nothing and is never called a server secret.
 *
 * Dependencies (fetch, openExternal) are injected so every path is testable
 * without the network or a browser.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { mediaFail, mediaOk, type MediaResult } from '@shared/media';

export const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';
export const GOOGLE_AUTH_URL = `${GOOGLE_AUTH_ORIGIN}/o/oauth2/v2/auth`;
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Read-only YouTube account data (Settings → Account connection). */
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export type GoogleOAuthScope =
  | typeof DRIVE_FILE_SCOPE
  | typeof YOUTUBE_READONLY_SCOPE;

/**
 * The only URL host this module will ever hand to the system browser. An
 * attacker who can influence the URL we open owns the user's browser session;
 * the allowlist makes "open whatever string arrived" unwritable.
 */
export function isAllowedAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === GOOGLE_AUTH_ORIGIN && parsed.pathname.startsWith('/o/oauth2/');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 64 random bytes → 86 base64url chars, inside the RFC 7636 43–128 window. */
export function generatePkceVerifier(): string {
  return base64Url(randomBytes(64));
}

export function pkceChallengeFor(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return base64Url(randomBytes(32));
}

/** Constant-time state comparison; a mismatch is an attack, not a typo. */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  /**
   * Exactly one scope per connection. Each feature (Drive playback, YouTube
   * account) asks for its own narrow scope in its own consent flow — no
   * connection ever piggybacks a second permission onto another's grant.
   */
  scope: GoogleOAuthScope;
  /**
   * Request a refresh token. Only set when establishing the stored
   * connection — repeatedly forcing the consent prompt on every sign-in is
   * hostile UX and Google flags it.
   */
  offline: boolean;
}

export function buildAuthUrl(params: AuthUrlParams): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  if (params.offline) {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Loopback listener
// ---------------------------------------------------------------------------

export interface LoopbackResult {
  code: string;
}

/** Default five minutes: long enough to type a password, short enough to die. */
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const CALLBACK_HTML =
  '<!doctype html><meta charset="utf-8"><title>NightWatch</title>' +
  '<body style="font-family:system-ui;background:#0b0e14;color:#e6e8ee;' +
  'display:grid;place-items:center;height:100vh;margin:0">' +
  '<p>Authorization was received. Return to NightWatch and wait for the app to confirm that the encrypted Drive connection was stored.</p>';

/**
 * One authorization attempt: listener, browser, exchange-ready code.
 *
 * The server binds 127.0.0.1:0 (a random free port), serves exactly one
 * callback, and closes on success, denial, timeout, or `abort()` — a listener
 * that outlives its attempt is an open port waiting for a spoofed callback.
 */
export class LoopbackAuthListener {
  private server: Server | null = null;
  private settled = false;
  /** Set while waitForCallback is pending, so abort() can resolve it. */
  private pendingAbort: (() => void) | null = null;

  /** Start listening. Resolves with the bound redirect URI. */
  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.settled) {
        reject(new Error('listener already aborted'));
        return;
      }
      const server = createServer();
      this.server = server;
      server.on('error', reject);
      // An abort that lands while the bind is still in flight closes the
      // server before 'listening' fires; without this, listen() would never
      // settle and the connect awaiting it would hang forever.
      server.on('close', () => reject(new Error('listener aborted')));
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('loopback bind failed'));
          return;
        }
        resolve(`http://127.0.0.1:${String(address.port)}/callback`);
      });
    });
  }

  /**
   * Wait for the redirect. Verifies state here, before the code is ever
   * returned to the caller. Every failure closes the listener.
   */
  waitForCallback(
    expectedState: string,
    timeoutMs: number = AUTH_TIMEOUT_MS,
  ): Promise<MediaResult<LoopbackResult>> {
    const server = this.server;
    if (server === null) {
      return Promise.resolve(mediaFail('internal', 'The sign-in listener is not running.'));
    }

    return new Promise((resolve) => {
      const finish = (result: MediaResult<LoopbackResult>): void => {
        if (this.settled) {
          return;
        }
        this.settled = true;
        this.pendingAbort = null;
        clearTimeout(timer);
        this.close();
        resolve(result);
      };

      // abort() must resolve a pending wait, or a connect() in flight when
      // the app exits (or the user cancels from the app side) hangs forever.
      this.pendingAbort = () => {
        finish(mediaFail('auth-cancelled', 'Google sign-in was cancelled.'));
      };

      const timer = setTimeout(() => {
        finish(
          mediaFail(
            'auth-timeout',
            'Google sign-in timed out. Check that the browser can return to NightWatch, then try again.',
          ),
        );
      }, timeoutMs);

      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          response.writeHead(404).end();
          return;
        }

        // Whatever the outcome, the browser tab gets the same page: the
        // outcome belongs in the app, not in a URL bar someone screenshots.
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(CALLBACK_HTML);

        if (this.settled) {
          // A second callback after settlement is a replay. Ignore it.
          return;
        }

        const error = url.searchParams.get('error');
        if (error !== null) {
          finish(
            error === 'access_denied'
              ? mediaFail(
                  'auth-cancelled',
                  'Google did not grant access. If you did not cancel, this account may not be approved for the app testing audience.',
                )
              : mediaFail('auth-cancelled', 'Google sign-in was cancelled.'),
          );
          return;
        }

        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (state === null || !statesMatch(expectedState, state)) {
          // Wrong state is a forged or replayed callback, not user error.
          finish(mediaFail('auth-cancelled', 'The sign-in response could not be verified.'));
          return;
        }
        if (code === null || code.length === 0) {
          finish(mediaFail('auth-cancelled', 'The sign-in response was incomplete.'));
          return;
        }
        finish(mediaOk({ code }));
      });
    });
  }

  /** Abort the attempt (app exit, user cancelled from the app side). */
  abort(): void {
    if (this.pendingAbort !== null) {
      this.pendingAbort();
      return;
    }
    this.settled = true;
    this.close();
  }

  private close(): void {
    this.server?.close();
    this.server?.closeAllConnections?.();
    this.server = null;
  }
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TokenResponse {
  accessToken: string;
  /** Seconds until expiry, from the provider. */
  expiresInSeconds: number;
  /** Present on the initial offline grant and on rotation. */
  refreshToken: string | null;
}

export interface OAuthClientConfig {
  clientId: string;
  /** Ships in the binary; not a secret. Some Google desktop clients need it. */
  clientSecret: string | null;
}

function parseTokenResponse(payload: unknown): TokenResponse | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const accessToken = record['access_token'];
  const expiresIn = record['expires_in'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null;
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }
  const refreshToken = record['refresh_token'];
  return {
    accessToken,
    expiresInSeconds: expiresIn,
    refreshToken: typeof refreshToken === 'string' && refreshToken.length > 0 ? refreshToken : null,
  };
}

export type TokenExchangeOutcome =
  | { status: 'ok'; tokens: TokenResponse }
  | { status: 'invalid-grant' }
  | { status: 'offline' }
  | { status: 'failed' };

async function postTokenEndpoint(
  fetchFn: FetchLike,
  body: URLSearchParams,
): Promise<TokenExchangeOutcome> {
  let response: Response;
  try {
    response = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    return { status: 'offline' };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Fall through: a non-JSON body is handled by status below.
  }

  if (!response.ok) {
    const error =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)['error']
        : null;
    // invalid_grant means the refresh token is dead (revoked, expired,
    // password change). The caller must clear it — retrying is pointless.
    return error === 'invalid_grant' ? { status: 'invalid-grant' } : { status: 'failed' };
  }

  const tokens = parseTokenResponse(payload);
  return tokens === null ? { status: 'failed' } : { status: 'ok', tokens };
}

export async function exchangeCodeForTokens(
  fetchFn: FetchLike,
  config: OAuthClientConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenExchangeOutcome> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (config.clientSecret !== null) {
    body.set('client_secret', config.clientSecret);
  }
  return postTokenEndpoint(fetchFn, body);
}

export async function refreshAccessToken(
  fetchFn: FetchLike,
  config: OAuthClientConfig,
  refreshToken: string,
): Promise<TokenExchangeOutcome> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (config.clientSecret !== null) {
    body.set('client_secret', config.clientSecret);
  }
  return postTokenEndpoint(fetchFn, body);
}

// ---------------------------------------------------------------------------
// The complete interactive flow, shared by every Google connection
// ---------------------------------------------------------------------------

export interface InteractiveAuthDeps {
  fetchFn: FetchLike;
  config: OAuthClientConfig;
  scope: GoogleOAuthScope;
  openExternal: (url: string) => Promise<void>;
  /** Surfaced so the owner (a manager) can abort on app exit. */
  onListener?: (listener: LoopbackAuthListener) => void;
}

export interface InteractiveAuthGrant {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
}

/**
 * One full installed-app authorization: loopback listener, system browser,
 * state-checked callback, code exchange. Returns only a grant that includes a
 * refresh token — a connection that cannot survive a restart is not a
 * connection, so the caller is never left holding half of one.
 */
export async function runInteractiveGoogleAuth(
  deps: InteractiveAuthDeps,
): Promise<MediaResult<InteractiveAuthGrant>> {
  const listener = new LoopbackAuthListener();
  deps.onListener?.(listener);
  try {
    const redirectUri = await listener.listen();

    const verifier = generatePkceVerifier();
    const state = generateState();
    const authUrl = buildAuthUrl({
      clientId: deps.config.clientId,
      redirectUri,
      challenge: pkceChallengeFor(verifier),
      state,
      scope: deps.scope,
      // Offline access is requested here, when establishing the stored
      // connection, and nowhere else.
      offline: true,
    });

    // Belt and braces: built against the Google origin one line up, and
    // still checked before anything reaches the system browser.
    if (!isAllowedAuthUrl(authUrl)) {
      return mediaFail('internal', 'The sign-in address failed validation.');
    }
    await deps.openExternal(authUrl);

    const callback = await listener.waitForCallback(state);
    if (!callback.ok) {
      return callback;
    }

    const exchanged = await exchangeCodeForTokens(
      deps.fetchFn,
      deps.config,
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

    return mediaOk({
      accessToken: exchanged.tokens.accessToken,
      expiresInSeconds: exchanged.tokens.expiresInSeconds,
      refreshToken: exchanged.tokens.refreshToken,
    });
  } catch {
    return mediaFail('internal', 'Google sign-in could not be started.');
  } finally {
    listener.abort();
  }
}

/** Best-effort revocation. Local credential deletion never depends on it. */
export async function revokeToken(fetchFn: FetchLike, token: string): Promise<void> {
  try {
    await fetchFn(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Offline revocation fails silently; the local deletion still happens.
  }
}
