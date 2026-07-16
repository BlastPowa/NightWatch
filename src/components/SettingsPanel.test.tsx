// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaFail, mediaOk } from '@shared/media';
import type { YouTubeAccountBridge } from '@shared/mediaBridge';
import { SettingsPanel } from './SettingsPanel';

afterEach(cleanup);

function bridge(overrides: Partial<YouTubeAccountBridge> = {}): YouTubeAccountBridge {
  return {
    getState: vi.fn(async () => ({
      connected: false,
      channelTitle: null,
      reason: null,
    })),
    connect: vi.fn(async () =>
      mediaOk({
        connected: true,
        channelTitle: 'NightWatch Test Channel',
        reason: null,
      }),
    ),
    disconnect: vi.fn(async () => mediaOk(undefined)),
    ...overrides,
  };
}

describe('SettingsPanel YouTube account', () => {
  it('connects through the typed desktop bridge and shows the channel', async () => {
    const youtubeAccount = bridge();
    const user = userEvent.setup();
    render(<SettingsPanel user={null} youtubeAccount={youtubeAccount} />);

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(await screen.findByRole('button', { name: 'Connect YouTube' }));

    expect(youtubeAccount.connect).toHaveBeenCalledOnce();
    expect(await screen.findByText(/NightWatch Test Channel/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('explains a loopback timeout instead of dismissing it as cancellation', async () => {
    const youtubeAccount = bridge({
      connect: vi.fn(async () =>
        mediaFail('auth-timeout', 'Google sign-in did not return to NightWatch in time.')),
    });
    const user = userEvent.setup();
    render(<SettingsPanel user={null} youtubeAccount={youtubeAccount} />);

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(await screen.findByRole('button', { name: 'Connect YouTube' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/browser, firewall, or VPN/i);
  });

  it('does not show a dead connect button when the release capability is off', async () => {
    const youtubeAccount = bridge({
      getState: vi.fn(async () => ({
        connected: false,
        channelTitle: null,
        reason: 'not-configured' as const,
      })),
    });
    const user = userEvent.setup();
    render(<SettingsPanel user={null} youtubeAccount={youtubeAccount} />);

    await user.click(screen.getByRole('button', { name: 'Account' }));

    expect((await screen.findAllByText('Desktop capability unavailable')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Connect YouTube' })).toBeNull();
  });
});
