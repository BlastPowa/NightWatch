import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock('@/lib/platform/RuntimeCapabilityService', () => ({
  reportOperation: vi.fn(),
}));

import {
  buildInviteTokenLink,
  isInviteToken,
  mintRoomInvite,
  parseInviteTokenLink,
  redeemRoomInvite,
  revokeRoomInvite,
} from './InviteTokenService';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('token shape', () => {
  it('accepts exactly 32 lowercase hex characters', () => {
    expect(isInviteToken(TOKEN)).toBe(true);
    expect(isInviteToken(TOKEN.toUpperCase())).toBe(false);
    expect(isInviteToken(`${TOKEN}0`)).toBe(false);
    expect(isInviteToken(TOKEN.slice(1))).toBe(false);
    expect(isInviteToken('not-a-token')).toBe(false);
    expect(isInviteToken(null)).toBe(false);
    expect(isInviteToken(42)).toBe(false);
  });

  it('round-trips a deep link and rejects anything else', () => {
    expect(parseInviteTokenLink(buildInviteTokenLink(TOKEN))).toBe(TOKEN);
    expect(parseInviteTokenLink(`  ${buildInviteTokenLink(TOKEN)}  `)).toBe(TOKEN);
    expect(parseInviteTokenLink('nightwatch://invite/short')).toBeNull();
    expect(parseInviteTokenLink('nightwatch://room/ABCDEF')).toBeNull();
    expect(parseInviteTokenLink('https://evil.example/invite/' + TOKEN)).toBeNull();
  });

  it('never puts a room code in a link', () => {
    expect(buildInviteTokenLink(TOKEN)).not.toContain('ABCDEF');
    expect(buildInviteTokenLink(TOKEN)).toBe(`nightwatch://invite/${TOKEN}`);
  });
});

describe('mintRoomInvite', () => {
  it('rejects a malformed room code without calling the server', async () => {
    const result = await mintRoomInvite('nope');
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('normalizes the code and returns the token', async () => {
    rpcMock.mockResolvedValue({
      data: [{ token: TOKEN, expires_at: '2026-07-25T00:15:00Z' }],
      error: null,
    });
    const result = await mintRoomInvite('  abcdef  ');
    expect(rpcMock).toHaveBeenCalledWith('mint_room_invite_token', {
      p_room_code: 'ABCDEF',
      p_ttl_seconds: 900,
    });
    expect(result.ok && result.value.token).toBe(TOKEN);
  });

  it('fails closed when the server returns a token of the wrong shape', async () => {
    rpcMock.mockResolvedValue({
      data: [{ token: 'ABCDEF', expires_at: '2026-07-25T00:15:00Z' }],
      error: null,
    });
    const result = await mintRoomInvite('ABCDEF');
    expect(result.ok).toBe(false);
  });

  it('fails closed on an empty result set', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect((await mintRoomInvite('ABCDEF')).ok).toBe(false);
  });
});

describe('redeemRoomInvite', () => {
  it('refuses a malformed token without calling the server', async () => {
    const result = await redeemRoomInvite('not-a-token');
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns the room code on success', async () => {
    rpcMock.mockResolvedValue({ data: 'ABCDEF', error: null });
    const result = await redeemRoomInvite(TOKEN);
    expect(result.ok && result.value).toBe('ABCDEF');
  });

  it('turns the server’s indistinguishable forbidden into one clear message', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const result = await redeemRoomInvite(TOKEN);
    expect(result.ok).toBe(false);
    // Spent, expired, revoked and unknown must all read the same to the user,
    // because they read the same on the server by design.
    expect(!result.ok && result.message).toMatch(/already been used or has expired/);
  });

  it('fails closed when the server returns a non-room-code', async () => {
    rpcMock.mockResolvedValue({ data: 'hello', error: null });
    expect((await redeemRoomInvite(TOKEN)).ok).toBe(false);
  });
});

describe('revokeRoomInvite', () => {
  it('is a silent success for a malformed token', async () => {
    expect((await revokeRoomInvite('nope')).ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls the revoke RPC for a well-formed token', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect((await revokeRoomInvite(TOKEN)).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('revoke_room_invite_token', { p_token: TOKEN });
  });
});
