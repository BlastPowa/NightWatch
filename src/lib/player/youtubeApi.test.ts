// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('loadYouTubeApi', () => {
  beforeEach(() => {
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    Reflect.deleteProperty(window, 'YT');
    Reflect.deleteProperty(window, 'onYouTubeIframeAPIReady');
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one in-flight request and one script tag', async () => {
    const { loadYouTubeApi } = await import('./youtubeApi');
    const first = loadYouTubeApi();
    const second = loadYouTubeApi();

    expect(first).toBe(second);
    expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1);

    const Player = vi.fn();
    window.YT = { Player } as unknown as typeof YT;
    window.onYouTubeIframeAPIReady?.();

    await expect(first).resolves.toMatchObject({ Player });
  });

  it('removes a failed NightWatch script and permits a clean retry', async () => {
    const { loadYouTubeApi } = await import('./youtubeApi');
    const first = loadYouTubeApi();
    const firstScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    expect(firstScript).not.toBeNull();

    const failed = expect(first).rejects.toThrow(/Failed to load/);
    firstScript?.dispatchEvent(new Event('error'));
    await failed;
    expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).toBeNull();

    const second = loadYouTubeApi();
    const secondScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    expect(secondScript).not.toBeNull();
    expect(secondScript).not.toBe(firstScript);

    const Player = vi.fn();
    window.YT = { Player } as unknown as typeof YT;
    window.onYouTubeIframeAPIReady?.();
    await expect(second).resolves.toMatchObject({ Player });
  });

  it('times out a stalled script so later attempts are not pinned forever', async () => {
    vi.useFakeTimers();
    const { loadYouTubeApi } = await import('./youtubeApi');
    const stalled = loadYouTubeApi();
    const rejected = expect(stalled).rejects.toThrow(/Timed out/);

    await vi.advanceTimersByTimeAsync(12_000);
    await rejected;
    expect(document.querySelector('script[src="https://www.youtube.com/iframe_api"]')).toBeNull();
  });
});
