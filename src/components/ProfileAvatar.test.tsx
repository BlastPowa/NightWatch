// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileAvatar } from '@/components/ProfileAvatar';

afterEach(cleanup);

describe('ProfileAvatar', () => {
  it('uses a resolved image and falls back to an initial after an image failure', () => {
    const { container } = render(
      <ProfileAvatar
        name="Night Owl"
        src="https://cdn.discordapp.com/avatars/123/avatar.png"
        className="avatar"
      />,
    );

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.discordapp.com/avatars/123/avatar.png');
    if (image !== null) fireEvent.error(image);

    expect(screen.getByText('N').className).toContain('profile-avatar-fallback');
  });

  it('renders a stable fallback when no avatar is supplied', () => {
    render(<ProfileAvatar name="Ghost" src={null} />);
    expect(screen.getByText('G')).toBeTruthy();
  });
});
