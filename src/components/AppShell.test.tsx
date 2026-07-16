// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/NotificationCenter', () => ({ NotificationCenter: () => null }));

import { AppShell } from '@/components/AppShell';

afterEach(cleanup);

function renderShell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSubmit = vi.fn();
  const onQueryChange = vi.fn();
  const props: Parameters<typeof AppShell>[0] = {
    children: <section>Current screen</section>,
    view: 'discover',
    onNavigate,
    isElectron: true,
    capabilities: { friends: true, messaging: true, creatorClubs: true, notifications: false },
    room: { active: false, code: '', name: '', memberCount: 0 },
    identity: { name: 'Night Owl', avatarUrl: null, connected: true },
    runtime: { connectionStatus: 'connected', bridgeError: null, appInfo: null },
    search: { query: 'cinema', busy: false, onQueryChange, onSubmit },
    ...overrides,
  };
  render(<AppShell {...props} />);
  return { onNavigate, onSubmit, onQueryChange };
}

describe('AppShell', () => {
  it('routes working navigation and profile actions', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();

    await user.click(screen.getByRole('button', { name: 'Friends' }));
    await user.click(screen.getByRole('button', { name: 'Open your profile' }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'friends');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'card');
  });

  it('submits a trimmed global search', async () => {
    const user = userEvent.setup();
    const submitSpy = vi.fn();
    renderShell({
      search: {
        query: '  midnight cinema  ',
        busy: false,
        onQueryChange: vi.fn(),
        onSubmit: submitSpy,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(submitSpy).toHaveBeenCalledWith('midnight cinema');
  });

  it('uses a labeled themed action for the active room', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell({
      room: { active: true, code: 'ABC234', name: 'Friday night', memberCount: 3 },
    });

    const roomAction = screen.getByRole('button', { name: 'Open current room' });
    expect(roomAction.textContent).toContain('Open room');
    await user.click(roomAction);
    expect(onNavigate).toHaveBeenCalledWith('main');
  });
});
