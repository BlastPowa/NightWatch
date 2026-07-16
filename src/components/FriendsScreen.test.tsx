// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSocialGraph, getCurrentRoomSuggestions, sendFriendRequest } = vi.hoisted(() => ({
  getSocialGraph: vi.fn(),
  getCurrentRoomSuggestions: vi.fn(),
  sendFriendRequest: vi.fn(),
}));

vi.mock('@/lib/social/FriendService', () => ({
  getSocialGraph,
  getCurrentRoomSuggestions,
  sendFriendRequest,
  acceptFriendRequest: vi.fn(),
  cancelFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
}));
vi.mock('@/lib/social/SocialRealtime', () => ({
  subscribeToFriendRequests: () => () => {},
}));
vi.mock('@/lib/social/PresenceService', () => ({
  getFriendPresence: vi.fn(async () => ({ status: 'ok', data: [] })),
}));
vi.mock('@/components/BlockedUsersPanel', () => ({
  BlockedUsersPanel: () => <div>Blocked list</div>,
}));
vi.mock('@/components/SocialProfileCard', () => ({
  SocialProfileCard: () => null,
}));

import { FriendsScreen } from '@/components/FriendsScreen';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  getSocialGraph.mockResolvedValue({
    status: 'ok',
    data: { friends: [], incoming: [], outgoing: [], suggestions: [] },
  });
  getCurrentRoomSuggestions.mockResolvedValue([{
    kind: 'suggestion',
    userId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
    displayName: 'Boogie',
    requestId: null,
    createdAt: '2026-07-16T10:00:00.000Z',
    avatarUrl: null,
    selectedBorderId: null,
    context: 'current-room',
  }]);
  sendFriendRequest.mockResolvedValue({ status: 'ok', data: undefined });
});

describe('FriendsScreen current-room discovery', () => {
  it('shows a server-resolved signed-in room member and can send a request', async () => {
    const user = userEvent.setup();
    render(
      <FriendsScreen
        currentRoomMembers={[{
          id: 'guest-presence-id',
          displayName: 'Untrusted peer label',
          joinedAt: 100,
          isHost: false,
          streakDays: 0,
          avatarUrl: null,
          socialUserId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
        }]}
        onMessage={vi.fn()}
      />,
    );

    expect(await screen.findByText('Boogie')).toBeTruthy();
    expect(screen.getByText('In your room')).toBeTruthy();
    expect(screen.getByText('Signed in and watching with you')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /add friend/i }));

    await waitFor(() => {
      expect(sendFriendRequest)
        .toHaveBeenCalledWith('71ac88dd-ecab-46e7-909a-c3bd8f228115');
    });
  });

  it('includes current-room suggestions in the search filter', async () => {
    const user = userEvent.setup();
    render(
      <FriendsScreen
        currentRoomMembers={[{
          id: 'guest-presence-id',
          displayName: 'Peer',
          joinedAt: 100,
          isHost: false,
          streakDays: 0,
          avatarUrl: null,
          socialUserId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
        }]}
        onMessage={vi.fn()}
      />,
    );

    await screen.findByText('Boogie');
    await user.type(
      screen.getByRole('searchbox', { name: 'Search friends and requests' }),
      'not-boogie',
    );
    expect(screen.queryByText('Boogie')).toBeNull();

    await user.clear(screen.getByRole('searchbox', { name: 'Search friends and requests' }));
    await user.type(
      screen.getByRole('searchbox', { name: 'Search friends and requests' }),
      'boog',
    );
    expect(screen.getByText('Boogie')).toBeTruthy();
  });
});
