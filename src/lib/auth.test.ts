// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auth } = vi.hoisted(() => ({
  auth: {
    exchangeCodeForSession: vi.fn(),
    signInWithOAuth: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('@/lib/log', () => ({ log: vi.fn() }));

import { completeSignIn } from '@/lib/auth';

describe('browser authentication callback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exchanges the PKCE code returned to the browser callback route', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });

    await completeSignIn('http://127.0.0.1:5173/auth/callback?code=browser-code');

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('browser-code');
  });

  it('surfaces provider errors from the browser callback', async () => {
    await expect(
      completeSignIn('http://127.0.0.1:5173/auth/callback?error=access_denied'),
    ).rejects.toThrow('access_denied');
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
