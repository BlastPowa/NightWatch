// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY,
  OnboardingTour,
  startOnboardingTour,
} from '@/components/OnboardingTour';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('OnboardingTour', () => {
  it('opens on first use and persists a skipped tour', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingTour
        includeLibrary
        currentView="discover"
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Welcome to NightWatch' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /skip tour/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('skipped');
  });

  it('can be restarted from FAQ after it was previously completed', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    render(
      <OnboardingTour
        includeLibrary={false}
        currentView="faq"
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => startOnboardingTour());
    expect(screen.getByRole('dialog', { name: 'Welcome to NightWatch' })).toBeTruthy();
  });
});
