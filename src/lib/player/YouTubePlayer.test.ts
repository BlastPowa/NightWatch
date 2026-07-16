// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const playerHarness = vi.hoisted(() => {
  const setOption = vi.fn();
  const player = {
    loadVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getPlayerState: vi.fn(() => -1),
    getOptions: vi.fn(() => ['captions']),
    setOption,
    destroy: vi.fn(),
  };
  return {
    options: null as YT.PlayerOptions | null,
    player,
    Player: vi.fn((_container: HTMLElement, options: YT.PlayerOptions) => {
      playerHarness.options = options;
      return player as unknown as YT.Player;
    }),
  };
});

vi.mock('@/lib/player/youtubeApi', () => ({
  loadYouTubeApi: vi.fn(async () => ({ Player: playerHarness.Player })),
}));

import { YouTubePlayer } from '@/lib/player/YouTubePlayer';

describe('YouTubePlayer caption preferences', () => {
  beforeEach(() => {
    playerHarness.options = null;
    playerHarness.Player.mockClear();
    playerHarness.player.getOptions.mockClear();
    playerHarness.player.setOption.mockClear();
  });

  it('requests available captions and language through official player vars', async () => {
    const player = new YouTubePlayer({}, {
      captionMode: 'always-on',
      captionLanguage: 'ja',
      captionFontSize: 2,
    });

    await player.mount(document.createElement('div'));

    expect(playerHarness.options?.playerVars).toMatchObject({
      cc_load_policy: 1,
      cc_lang_pref: 'ja',
    });
    playerHarness.options?.events?.onReady?.({
      target: playerHarness.player as unknown as YT.Player,
    });
    expect(playerHarness.player.setOption).toHaveBeenCalledWith('captions', 'fontSize', 2);
  });

  it('keeps YouTube defaults and applies caption size after an API change', async () => {
    const player = new YouTubePlayer({}, {
      captionMode: 'youtube-default',
      captionLanguage: 'auto',
      captionFontSize: 0,
    });

    await player.mount(document.createElement('div'));

    expect(playerHarness.options?.playerVars?.cc_load_policy).toBeUndefined();
    expect(playerHarness.options?.playerVars?.cc_lang_pref).toBeUndefined();
    playerHarness.options?.events?.onReady?.({
      target: playerHarness.player as unknown as YT.Player,
    });
    playerHarness.player.setOption.mockClear();
    player.setCaptionFontSize(3);
    playerHarness.options?.events?.onApiChange?.({
      target: playerHarness.player as unknown as YT.Player,
    });
    expect(playerHarness.player.setOption).toHaveBeenLastCalledWith('captions', 'fontSize', 3);
  });
});
