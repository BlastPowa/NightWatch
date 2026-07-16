import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: vi.fn() },
  },
}));

import {
  heartbeatLiveRoomSocial,
  leaveLiveRoomSocial,
  listLiveRoomCoWatchers,
} from '@/lib/social/LiveRoomSocialService';

beforeEach(() => {
  rpc.mockReset();
});

describe('heartbeatLiveRoomSocial', () => {
  it('normalizes the code and sends the presence id', async () => {
    rpc.mockResolvedValue({ data: 'ok', error: null });
    const result = await heartbeatLiveRoomSocial('abc234', 'presence-1');
    expect(result.status).toBe('ok');
    expect(rpc).toHaveBeenCalledWith('heartbeat_live_room_social', {
      p_room_code: 'ABC234',
      p_presence_id: 'presence-1',
    });
  });

  it('rejects an invalid room code without calling the server', async () => {
    const result = await heartbeatLiveRoomSocial('nope', 'presence-1');
    expect(result.status).toBe('forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unsafe presence id without calling the server', async () => {
    const result = await heartbeatLiveRoomSocial('ABC234', 'bad id!');
    expect(result.status).toBe('forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a raised rate limit onto the typed result', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'rate-limited', code: 'P0001', details: null, hint: null },
    });
    const result = await heartbeatLiveRoomSocial('ABC234', 'presence-1');
    expect(result.status).toBe('rate-limited');
  });
});

describe('listLiveRoomCoWatchers', () => {
  it('returns typed co-watchers and drops malformed rows', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          user_id: 'u-1',
          display_name: 'Bob',
          avatar_url: 'https://cdn.discordapp.com/a.png',
          selected_border_id: 'gold',
        },
        { user_id: 'u-2', display_name: null, avatar_url: '', selected_border_id: null },
        { nonsense: true },
        null,
      ],
      error: null,
    });
    const result = await listLiveRoomCoWatchers('ABC234');
    expect(result).toEqual({
      status: 'ok',
      data: [
        {
          userId: 'u-1',
          displayName: 'Bob',
          avatarUrl: 'https://cdn.discordapp.com/a.png',
          selectedBorderId: 'gold',
        },
        { userId: 'u-2', displayName: 'Someone', avatarUrl: null, selectedBorderId: null },
      ],
    });
  });

  it("maps the server's freshness gate onto forbidden", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'forbidden', code: 'P0001', details: null, hint: null },
    });
    const result = await listLiveRoomCoWatchers('ABC234');
    expect(result.status).toBe('forbidden');
  });

  it('reports not-ready when the migration is missing', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function does not exist', code: '42883', details: null, hint: null },
    });
    const result = await listLiveRoomCoWatchers('ABC234');
    expect(result.status).toBe('not-ready');
  });
});

describe('leaveLiveRoomSocial', () => {
  it('deletes presence for a valid code', async () => {
    rpc.mockResolvedValue({ data: 'ok', error: null });
    const result = await leaveLiveRoomSocial('xyz789');
    expect(result.status).toBe('ok');
    expect(rpc).toHaveBeenCalledWith('leave_live_room_social', { p_room_code: 'XYZ789' });
  });

  it('never sends an invalid code', async () => {
    const result = await leaveLiveRoomSocial('!!!!!!');
    expect(result.status).toBe('forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });
});
