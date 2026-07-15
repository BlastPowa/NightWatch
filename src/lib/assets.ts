import { getPlatformBridge } from '@/platform/PlatformBridge';

const DISCORD_CDN_HOST = 'cdn.discordapp.com';
const YOUTUBE_CHANNEL_HOSTS = new Set(['yt3.ggpht.com', 'yt3.googleusercontent.com']);

/**
 * Convert a Discord avatar into the canonical value that is safe to persist or
 * publish. Query strings are presentation hints (normally `size`) and are not
 * part of the identity of the asset.
 */
export function canonicalDiscordAvatarUrl(value: string | null): string | null {
  if (value === null || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== DISCORD_CDN_HOST ||
      url.username !== '' ||
      url.password !== '' ||
      !url.pathname.startsWith('/')
    ) {
      return null;
    }
    return `https://${DISCORD_CDN_HOST}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Discord Activities may only load allow-listed external assets through their
 * URL mappings. Electron and the browser keep the canonical HTTPS URL.
 */
export function resolveExternalAssetUrl(value: string | null): string | null {
  if (value === null || getPlatformBridge().kind !== 'discord') return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.hostname === DISCORD_CDN_HOST) {
      return `/discordcdn${url.pathname}${url.search}`;
    }
    if (YOUTUBE_CHANNEL_HOSTS.has(url.hostname)) {
      return `/ytchannel${url.pathname}${url.search}`;
    }
    if (url.hostname === 'i.ytimg.com') {
      return `/ytimg${url.pathname}${url.search}`;
    }
    return value;
  } catch {
    return null;
  }
}
