import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUTH_TIMEOUT_MS,
  DRIVE_FILE_SCOPE,
  LoopbackAuthListener,
  buildAuthUrl,
  exchangeCodeForTokens,
  generatePkceVerifier,
  generateState,
  isAllowedAuthUrl,
  pkceChallengeFor,
  refreshAccessToken,
  revokeToken,
  statesMatch,
  type FetchLike,
} from './driveAuth';

const config = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: null };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('pkce', () => {
  it('generates verifiers inside the RFC 7636 length window', () => {
    for (let i = 0; i < 50; i++) {
      const verifier = generatePkceVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('never repeats a verifier or a state', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generatePkceVerifier());
      seen.add(generateState());
    }
    expect(seen.size).toBe(400);
  });

  it('derives the S256 challenge exactly per the RFC', () => {
    const verifier = generatePkceVerifier();
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(pkceChallengeFor(verifier)).toBe(expected);
  });

  it('matches the RFC appendix B test vector', () => {
    expect(pkceChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('state comparison', () => {
  it('accepts equal states and rejects everything else', () => {
    const state = generateState();
    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, state.slice(0, -1))).toBe(false);
    expect(statesMatch(state, generateState())).toBe(false);
    expect(statesMatch(state, '')).toBe(false);
  });
});

describe('authorization url', () => {
  const url = new URL(
    buildAuthUrl({
      clientId: config.clientId,
      redirectUri: 'http://127.0.0.1:54321/callback',
      challenge: 'challenge-value',
      state: 'state-value',
      scope: DRIVE_FILE_SCOPE,
      offline: true,
    }),
  );

  it('points at the allowlisted Google host', () => {
    expect(url.origin).toBe('https://accounts.google.com');
    expect(isAllowedAuthUrl(url.toString())).toBe(true);
  });

  it('requests only drive.file', () => {
    expect(url.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
    expect(url.searchParams.get('scope')).not.toContain(' ');
  });

  it('uses S256, never plain', () => {
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('asks for offline access only when establishing the connection', () => {
    expect(url.searchParams.get('access_type')).toBe('offline');
    const online = new URL(
      buildAuthUrl({
        clientId: config.clientId,
        redirectUri: 'http://127.0.0.1:54321/callback',
        challenge: 'c',
        state: 's',
        scope: DRIVE_FILE_SCOPE,
        offline: false,
      }),
    );
    expect(online.searchParams.get('access_type')).toBeNull();
    expect(online.searchParams.get('prompt')).toBeNull();
  });
});

describe('the browser-open allowlist', () => {
  it('rejects every non-Google url, including lookalikes', () => {
    for (const bad of [
      'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
      'https://accounts-google.com/o/oauth2/v2/auth',
      'http://accounts.google.com/o/oauth2/v2/auth',
      'https://accounts.google.com/signin/other',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedAuthUrl(bad)).toBe(false);
    }
  });
});

describe('loopback listener', () => {
  async function startFlow(): Promise<{
    listener: LoopbackAuthListener;
    redirectUri: string;
    state: string;
  }> {
    const listener = new LoopbackAuthListener();
    const redirectUri = await listener.listen();
    return { listener, redirectUri, state: generateState() };
  }

  it('binds a random port on 127.0.0.1 only', async () => {
    const { listener, redirectUri } = await startFlow();
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    listener.abort();
  });

  it('accepts a callback carrying the right state', async () => {
    const { listener, redirectUri, state } = await startFlow();
    const wait = listener.waitForCallback(state);
    const response = await fetch(`${redirectUri}?code=auth-code-123&state=${state}`);
    expect(response.status).toBe(200);
    const result = await wait;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe('auth-code-123');
    }
  });

  it('rejects a wrong state as a forged callback', async () => {
    const { listener, redirectUri, state } = await startFlow();
    const wait = listener.waitForCallback(state);
    await fetch(`${redirectUri}?code=stolen&state=${generateState()}`);
    const result = await wait;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth-cancelled');
    }
  });

  it('treats a provider error as cancellation', async () => {
    const { listener, redirectUri, state } = await startFlow();
    const wait = listener.waitForCallback(state);
    await fetch(`${redirectUri}?error=access_denied&state=${state}`);
    const result = await wait;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth-cancelled');
      expect(result.error.message).toMatch(/testing audience/i);
    }
  });

  it('never leaks the code back into the browser response', async () => {
    const { listener, redirectUri, state } = await startFlow();
    const wait = listener.waitForCallback(state);
    const response = await fetch(`${redirectUri}?code=super-secret-code&state=${state}`);
    const html = await response.text();
    expect(html).not.toContain('super-secret-code');
    expect(html).not.toContain(state);
    await wait;
  });

  it('ignores a replayed callback after settlement', async () => {
    const { listener, redirectUri, state } = await startFlow();
    const wait = listener.waitForCallback(state);
    await fetch(`${redirectUri}?code=first&state=${state}`);
    const result = await wait;
    expect(result.ok).toBe(true);
    // The port is closed; the replay cannot even connect.
    await expect(fetch(`${redirectUri}?code=replay&state=${state}`)).rejects.toThrow();
  });

  it('times out and closes rather than listening forever', async () => {
    const { listener, state } = await startFlow();
    const result = await listener.waitForCallback(state, 30);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth-timeout');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('has a sane default timeout', () => {
    expect(AUTH_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('abort() resolves a pending wait so a connect never hangs on app exit', async () => {
    const { listener, state } = await startFlow();
    const wait = listener.waitForCallback(state);
    listener.abort();
    const result = await wait;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth-cancelled');
    }
  });
});

describe('token exchange', () => {
  it('sends the verifier and parses a good response', async () => {
    let sentBody = '';
    const fetchFn: FetchLike = async (url, init) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      sentBody = String(init.body);
      return jsonResponse(200, {
        access_token: 'at-1',
        expires_in: 3600,
        refresh_token: 'rt-1',
      });
    };
    const outcome = await exchangeCodeForTokens(fetchFn, config, 'code-1', 'verifier-1', 'http://127.0.0.1:1/callback');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.tokens.accessToken).toBe('at-1');
      expect(outcome.tokens.refreshToken).toBe('rt-1');
    }
    const params = new URLSearchParams(sentBody);
    expect(params.get('code_verifier')).toBe('verifier-1');
    expect(params.get('grant_type')).toBe('authorization_code');
  });

  it('maps invalid_grant distinctly from other failures', async () => {
    const invalid: FetchLike = async () => jsonResponse(400, { error: 'invalid_grant' });
    expect((await refreshAccessToken(invalid, config, 'dead-rt')).status).toBe('invalid-grant');

    const serverError: FetchLike = async () => jsonResponse(500, { error: 'internal' });
    expect((await refreshAccessToken(serverError, config, 'rt')).status).toBe('failed');
  });

  it('maps a network failure to offline', async () => {
    const down: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect((await refreshAccessToken(down, config, 'rt')).status).toBe('offline');
  });

  it('rejects a malformed token payload', async () => {
    const weird: FetchLike = async () => jsonResponse(200, { access_token: '', expires_in: -5 });
    expect((await refreshAccessToken(weird, config, 'rt')).status).toBe('failed');
  });

  it('revocation failure is silent — local deletion never depends on it', async () => {
    const down: FetchLike = async () => {
      throw new Error('offline');
    };
    await expect(revokeToken(down, 'rt')).resolves.toBeUndefined();
  });
});
