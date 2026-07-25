// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSocialGraph, getRoomPeople, searchPeople, listLiveRoomCoWatchers, sendFriendRequest } = vi.hoisted(() => ({
  getSocialGraph: vi.fn(),
  getRoomPeople: vi.fn(),
  searchPeople: vi.fn(),
  listLiveRoomCoWatchers: vi.fn(),
  sendFriendRequest: vi.fn(),
}));

vi.mock('@/lib/social/FriendService', () => ({
  getSocialGraph,
  sendFriendRequest,
  acceptFriendRequest: vi.fn(),
  cancelFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
}));
vi.mock('@/lib/social/LiveRoomSocialService', () => ({
  listLiveRoomCoWatchers,
}));
vi.mock('@/lib/people/PeopleService', () => ({
  SEARCH_MIN_CHARS: 3,
  getRoomPeople,
  searchPeople,
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
  listLiveRoomCoWatchers.mockResolvedValue({
    status: 'ok',
    data: [{
      userId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
      displayName: 'Boogie',
      avatarUrl: null,
      selectedBorderId: null,
    }],
  });
  getRoomPeople.mockResolvedValue({
    ok: true,
    value: [{
      userId: '71ac88dd-ecab-46e7-909a-c3bd8f228115',
      handle: 'boogie',
      displayName: 'Boogie',
      avatarUrl: null,
      border: null,
      relationship: 'none',
    }],
  });
  searchPeople.mockResolvedValue({ ok: true, value: [] });
  sendFriendRequest.mockResolvedValue({ status: 'ok', data: undefined });
});

describe('FriendsScreen current-room discovery', () => {
  it('shows a server-resolved signed-in room member and can send a request', async () => {
    const user = userEvent.setup();
    render(
      <FriendsScreen
        currentRoomCode="ABC234"
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
        currentRoomCode="ABC234"
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

  it('searches the public people directory after three characters', async () => {
    searchPeople.mockResolvedValue({
      ok: true,
      value: [{
        userId: 'f0d970ef-f364-476e-b514-ec52e6d13b41',
        handle: 'nightowl',
        displayName: 'Night Owl',
        avatarUrl: null,
        border: null,
        relationship: 'none',
      }],
    });
    const user = userEvent.setup();
    render(<FriendsScreen onMessage={vi.fn()} />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search friends and requests' }),
      'night',
    );

    expect(await screen.findByText('Night Owl')).toBeTruthy();
    expect(searchPeople).toHaveBeenCalledWith('night');
    expect(screen.getByText('@nightowl')).toBeTruthy();
  });
});
