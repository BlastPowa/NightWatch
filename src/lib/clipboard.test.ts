// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/lib/clipboard';

describe('copyText', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(copyText('room-link')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('room-link');
  });

  it('falls back to the DOM copy command when the async API fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await expect(copyText('room-link')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});
