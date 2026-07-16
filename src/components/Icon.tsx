import type { CSSProperties } from 'react';

export type IconName =
  | 'home' | 'play' | 'parties' | 'friends' | 'message' | 'creator'
  | 'profile' | 'settings' | 'info' | 'search' | 'close' | 'bell'
  | 'music' | 'gaming' | 'live' | 'film' | 'entertainment' | 'comedy'
  | 'sports' | 'news' | 'education' | 'technology' | 'travel' | 'tools'
  | 'pets' | 'autos' | 'sparkle' | 'chevron-left' | 'chevron-right'
  | 'plus' | 'check' | 'send' | 'clock' | 'lock' | 'users' | 'maximize';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * NightWatch's local, dependency-free outline icon system. Every icon shares
 * one optical weight and inherits the active theme/accent through currentColor.
 */
export function Icon({ name, size = 18, className, style }: IconProps): JSX.Element {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {glyph(name)}
    </svg>
  );
}

function glyph(name: IconName): JSX.Element {
  switch (name) {
    case 'home': return <><path d="m3 11 9-7 9 7" /><path d="M5.5 10v10h13V10" /><path d="M9.5 20v-6h5v6" /></>;
    case 'play': return <><path d="M7 4.8v14.4L19 12 7 4.8Z" /><circle cx="12" cy="12" r="10" opacity=".35" /></>;
    case 'parties': return <><rect x="4" y="5" width="14" height="14" rx="2" /><path d="M8 9h6M8 13h6M8 17h4" /><path d="M18 8h2v11a2 2 0 0 1-2 2H7v-2" /></>;
    case 'friends': case 'users': return <><path d="M16 20v-1.7a3.3 3.3 0 0 0-3.3-3.3H6.3A3.3 3.3 0 0 0 3 18.3V20" /><circle cx="9.5" cy="8" r="3" /><path d="M16 11a3 3 0 1 0 0-6M18 20v-1.5a3 3 0 0 0-2-2.8" /></>;
    case 'message': return <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.4A2.5 2.5 0 0 1 4 13.5v-8Z" /><path d="M8 8h8M8 12h5" /></>;
    case 'creator': return <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /><path d="m17.7 6.3-2.1 2.1" /></>;
    case 'profile': return <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /><circle cx="12" cy="12" r="10" opacity=".35" /></>;
    case 'settings': return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.4.3.7.6 1 .3.2.7.4 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>;
    case 'info': return <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>;
    case 'search': return <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></>;
    case 'close': return <path d="m6 6 12 12M18 6 6 18" />;
    case 'bell': return <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>;
    case 'music': return <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>;
    case 'gaming': return <><path d="M8 8h8a5 5 0 0 1 4.8 6.4l-1 3.3a2 2 0 0 1-3.3.9L14 16h-4l-2.5 2.6a2 2 0 0 1-3.3-.9l-1-3.3A5 5 0 0 1 8 8Z" /><path d="M7 12v4M5 14h4M16 13h.01M18 15h.01" /></>;
    case 'live': return <><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" /></>;
    case 'film': return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" /></>;
    case 'entertainment': return <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />;
    case 'comedy': return <><path d="M5 4h14v7a7 7 0 0 1-14 0V4Z" /><path d="M8 9h.01M16 9h.01M8.5 13.5c2.2 2 4.8 2 7 0" /></>;
    case 'sports': return <><circle cx="12" cy="12" r="9" /><path d="m8 4 2 4-3 3-4-1M16 4l-2 4 3 3 4-1M7 18l1-4h8l1 4M10 8h4" /></>;
    case 'news': return <><path d="M4 4h13v16H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z" /><path d="M17 8h3v10a2 2 0 0 1-2 2M7 8h6M7 12h6M7 16h4" /></>;
    case 'education': return <><path d="m3 10 9-5 9 5-9 5-9-5Z" /><path d="M7 13.5V17c3 2 7 2 10 0v-3.5M21 10v6" /></>;
    case 'technology': return <><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>;
    case 'travel': return <><path d="m3 11 18-7-7 17-3-8-8-2Z" /><path d="m11 13 5-5" /></>;
    case 'tools': return <><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 8.6 7 6.3 4.7a4 4 0 0 0 5 5l7.1 7.1a2.1 2.1 0 0 1-3 3l-7.1-7.1" /></>;
    case 'pets': return <><circle cx="8" cy="8" r="2" /><circle cx="16" cy="8" r="2" /><circle cx="5" cy="13" r="2" /><circle cx="19" cy="13" r="2" /><path d="M8 18c0-2.2 1.8-4 4-4s4 1.8 4 4c0 2-2 3-4 3s-4-1-4-3Z" /></>;
    case 'autos': return <><path d="m5 16-1-2 2-5h12l2 5-1 2" /><path d="M5 16v3M19 16v3M4 14h16v3H4zM7 12h.01M17 12h.01" /></>;
    case 'sparkle': return <><path d="m12 2 1.3 4.7L18 8l-4.7 1.3L12 14l-1.3-4.7L6 8l4.7-1.3L12 2Z" /><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z" /></>;
    case 'chevron-left': return <path d="m15 18-6-6 6-6" />;
    case 'chevron-right': return <path d="m9 18 6-6-6-6" />;
    case 'plus': return <path d="M12 5v14M5 12h14" />;
    case 'check': return <path d="m5 12 4 4L19 6" />;
    case 'send': return <><path d="m3 3 18 9-18 9 3-9-3-9Z" /><path d="M6 12h15" /></>;
    case 'clock': return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
    case 'lock': return <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>;
    case 'maximize': return <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5" /></>;
  }
}
