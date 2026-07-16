// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FaqScreen } from '@/components/FaqScreen';

afterEach(cleanup);

describe('FaqScreen', () => {
  it('filters answers by a search phrase', async () => {
    const user = userEvent.setup();
    render(<FaqScreen />);

    await user.type(screen.getByRole('searchbox'), 'end-to-end');

    expect(screen.getByRole('heading', { name: '1 answer' })).toBeTruthy();
    expect(screen.getByText('Are messages end-to-end encrypted?')).toBeTruthy();
    expect(screen.queryByText('How does synchronized playback work?')).toBeNull();
  });

  it('filters by feature category', async () => {
    const user = userEvent.setup();
    render(<FaqScreen />);

    await user.click(screen.getByRole('button', { name: 'Library & Drive' }));

    expect(screen.getByRole('heading', { name: '5 answers' })).toBeTruthy();
    expect(screen.getByText('What access does Google Drive receive?')).toBeTruthy();
  });
});
