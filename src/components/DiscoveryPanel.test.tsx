// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TRENDING = {
  videoId: 'abcdefghijk',
  title: 'Night Drive',
  channelTitle: 'Moon Channel',
  channelThumbnailUrl: '',
  thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg',
  durationText: '4:12',
};

const FRIEND_VIDEO = {
  videoId: '123456789ab',
  title: 'Shared Premiere',
  channelTitle: 'Friend Channel',
  channelThumbnailUrl: '',
  thumbnailUrl: 'https://i.ytimg.com/vi/123456789ab/mqdefault.jpg',
  durationText: '8:03',
};

vi.mock('@/lib/search/SearchService', () => ({
  getTrending: vi.fn(async () => ({ status: 'ok', results: [TRENDING], nextPageToken: null })),
  searchYouTube: vi.fn(async () => ({ status: 'ok', results: [TRENDING], nextPageToken: null })),
  getVideoDetails: vi.fn(async () => ({ status: 'ok', details: FRIEND_VIDEO })),
}));

vi.mock('@/lib/rooms/HistoryService', () => ({
  listHistory: vi.fn(async () => []),
}));

vi.mock('@/lib/social/PresenceService', () => ({
  getFriendMediaPresence: vi.fn(async () => ({
    status: 'ok',
    data: [{
      userId: 'friend-1',
      displayName: 'Luna',
      avatarUrl: null,
      selectedBorderId: null,
      status: 'watching',
      videoTitle: FRIEND_VIDEO.title,
      videoId: FRIEND_VIDEO.videoId,
      updatedAt: '',
    }],
  })),
}));

import { DiscoveryPanel } from '@/components/DiscoveryPanel';

describe('DiscoveryPanel browsing views and previews', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('hover: hover') || query.includes('min-width: 900px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('IntersectionObserver', class {
      public observe(): void {}
      public disconnect(): void {}
      public unobserve(): void {}
      public takeRecords(): IntersectionObserverEntry[] { return []; }
      public readonly root = null;
      public readonly rootMargin = '';
      public readonly thresholds = [];
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the capability-gated friend view and starts a muted official preview', async () => {
    const user = userEvent.setup();
    render(
      <DiscoveryPanel
        callerId="self"
        isHost
        roomCode=""
        searchRequest={null}
        friendMediaPresence
        onPlayNow={vi.fn()}
        onQueueAdd={() => true}
      />,
    );

    await screen.findByText(TRENDING.title);
    expect(screen.getByRole('tab', { name: 'Friends watching' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Friends watching' }));
    expect(await screen.findByText(FRIEND_VIDEO.title)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Discover' }));
    const card = (await screen.findByText(TRENDING.title)).closest('.media-card');
    expect(card).toBeTruthy();
    fireEvent.pointerEnter(card as Element);

    const preview = await waitFor(
      () => screen.getByTitle(`Preview ${TRENDING.title}`),
      { timeout: 1_400 },
    );
    expect(preview.getAttribute('src')).toContain('mute=1');
    expect(preview.getAttribute('src')).toContain('youtube-nocookie.com');
    expect(card?.querySelector('.media-preview-actions')).toBeTruthy();

    fireEvent.pointerLeave(card as Element);
    await waitFor(() => expect(screen.queryByTitle(`Preview ${TRENDING.title}`)).toBeNull());
  });
});
