import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSocialProfile, cacheDisplayName } = vi.hoisted(() => ({
  getSocialProfile: vi.fn(),
  cacheDisplayName: vi.fn(),
}));

vi.mock('@/lib/social/SocialProfileService', () => ({ getSocialProfile }));
vi.mock('@/lib/social/SocialRealtime', () => ({ cacheDisplayName }));
vi.mock('@/lib/engagement/CloudSync', () => ({
  getCloudSyncState: () => ({ synced: false, shareStats: false }),
  whenSyncReady: async () => {},
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { getCurrentRoomSuggestions } from '@/lib/social/FriendService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCurrentRoomSuggestions', () => {
  it('uses server profile identity rather than the peer presence label', async () => {
    getSocialProfile.mockResolvedValue({
      status: 'ok',
      data: {
        userId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
        displayName: 'Trusted Boogie',
        avatarUrl: 'https://cdn.discordapp.com/avatars/123/avatar.png',
        selectedBorderId: 'first-night',
        isSelf: false,
        isFriend: false,
      },
    });

    const result = await getCurrentRoomSuggestions([{
      socialUserId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
      joinedAt: Date.parse('2026-07-16T10:00:00.000Z'),
    }]);

    expect(result).toEqual([expect.objectContaining({
      userId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
      displayName: 'Trusted Boogie',
      context: 'current-room',
    })]);
    expect(cacheDisplayName)
      .toHaveBeenCalledWith('71ac88dd-ecab-46e7-909a-c3bd8f228115', 'Trusted Boogie');
  });

  it('drops self, existing friends, blocked profiles, and duplicate candidates', async () => {
    getSocialProfile
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          userId: '11111111-1111-4111-8111-111111111111',
          displayName: 'Self',
          avatarUrl: null,
          selectedBorderId: null,
          isSelf: true,
          isFriend: false,
        },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          userId: '22222222-2222-4222-8222-222222222222',
          displayName: 'Friend',
          avatarUrl: null,
          selectedBorderId: null,
          isSelf: false,
          isFriend: true,
        },
      })
      .mockResolvedValueOnce({ status: 'blocked' });

    const result = await getCurrentRoomSuggestions([
      { socialUserId: '11111111-1111-4111-8111-111111111111', joinedAt: 1 },
      { socialUserId: '22222222-2222-4222-8222-222222222222', joinedAt: 2 },
      { socialUserId: '33333333-3333-4333-8333-333333333333', joinedAt: 3 },
      { socialUserId: '33333333-3333-4333-8333-333333333333', joinedAt: 4 },
      { socialUserId: null, joinedAt: 5 },
    ]);

    expect(result).toEqual([]);
    expect(getSocialProfile).toHaveBeenCalledTimes(3);
  });
});
