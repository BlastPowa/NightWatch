// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomService, RoomState } from '@/lib/room/RoomService';

vi.mock('@/components/PlayerPanel', () => ({ PlayerPanel: () => <div>Official player stage</div> }));
vi.mock('@/components/QueuePanel', () => ({ QueuePanel: () => <div>Queue content</div> }));
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: () => <div>Chat content</div> }));
vi.mock('@/components/SearchBox', () => ({ SearchBox: () => <div>Discovery content</div> }));
vi.mock('@/hooks/useQueue', () => ({
  useQueue: () => ({ entries: [], add: vi.fn(), vote: vi.fn(), remove: vi.fn(), popNext: vi.fn(() => null) }),
}));
vi.mock('@/lib/analytics/SessionRecorder', () => ({
  sessionRecorder: { configure: vi.fn(), end: vi.fn(), members: vi.fn() },
}));

import { RoomScreen } from '@/components/RoomScreen';

afterEach(cleanup);

const ROOM: RoomState = {
  code: 'ABC234',
  status: 'joined',
  hostId: 'self',
  members: [{ id: 'self', displayName: 'Night Owl', joinedAt: 1, isHost: true, streakDays: 4, avatarUrl: null }],
};

describe('RoomScreen companion dock', () => {
  it('switches panels and exposes correct tab relationships', async () => {
    const user = userEvent.setup();
    render(
      <RoomScreen
        room={ROOM}
        service={{} as RoomService}
        selfId="self"
        presentation="full"
        meta={null}
        pendingVideo={null}
        onPendingHandled={vi.fn()}
        onMediaStateChange={vi.fn()}
        onReturnToRoom={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    expect(chatTab.getAttribute('aria-controls')).toBe('room-dock-panel-chat');
    await user.click(chatTab);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('room-dock-tab-chat');
    expect(screen.getByText('Chat content')).toBeTruthy();
  });

  it('supports arrow-key navigation across dock tabs', async () => {
    const user = userEvent.setup();
    render(
      <RoomScreen
        room={ROOM}
        service={{} as RoomService}
        selfId="self"
        presentation="full"
        meta={null}
        pendingVideo={null}
        onPendingHandled={vi.fn()}
        onMediaStateChange={vi.fn()}
        onReturnToRoom={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const queueTab = screen.getByRole('tab', { name: 'Up next' });
    queueTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Chat content')).toBeTruthy();
  });

  it('changes to mini presentation without replacing the player stage', () => {
    const props = {
      room: ROOM,
      service: {} as RoomService,
      selfId: 'self',
      meta: null,
      pendingVideo: null,
      onPendingHandled: vi.fn(),
      onMediaStateChange: vi.fn(),
      onReturnToRoom: vi.fn(),
      onLeave: vi.fn(),
    };
    const { container, rerender } = render(<RoomScreen {...props} presentation="full" />);
    const stage = screen.getByText('Official player stage');

    rerender(<RoomScreen {...props} presentation="mini" />);

    expect(screen.getByText('Official player stage')).toBe(stage);
    expect(container.querySelector('.room-view-mini')).toBeTruthy();
  });
});
