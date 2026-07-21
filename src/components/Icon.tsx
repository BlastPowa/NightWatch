import type { CSSProperties } from 'react';

export type IconName =
  | 'home' | 'play' | 'play-solid' | 'parties' | 'friends' | 'message' | 'creator'
  | 'profile' | 'library' | 'settings' | 'info' | 'help' | 'cloud' | 'shield'
  | 'image' | 'upload'
  | 'compass' | 'search' | 'close' | 'bell'
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
 * NightWatch's local, dependency-free Coolicons-derived outline system.
 * Selected glyph paths are adapted under CC BY 4.0 (see THIRD_PARTY_NOTICES.md).
 * Every icon shares one optical weight and inherits the active theme/accent.
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
    case 'play': return <><circle cx="12" cy="12" r="9" /><path d="M10 15V9l5 3-5 3Z" /></>;
    case 'play-solid': return <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none" />;
    case 'parties': return <><rect x="4" y="5" width="14" height="14" rx="2" /><path d="M8 9h6M8 13h6M8 17h4" /><path d="M18 8h2v11a2 2 0 0 1-2 2H7v-2" /></>;
    case 'friends': case 'users': return <path d="M17 20c0-1.66-2.24-3-5-3s-5 1.34-5 3M21 17c0-1.23-1.23-2.29-3-2.75M3 17c0-1.23 1.23-2.29 3-2.75M18 10.24A3 3 0 0 0 16 5c-.77 0-1.47.29-2 .76M6 10.24A3 3 0 0 1 8 5c.77 0 1.47.29 2 .76M12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />;
    case 'message': return <path d="m5.6 19.92 1.52-1.22c.32-.25.48-.39.67-.48.16-.08.33-.14.51-.18.2-.04.41-.04.82-.04h8.68c1.12 0 1.68 0 2.11-.22.38-.19.68-.5.87-.87.22-.43.22-.99.22-2.11V7.2c0-1.12 0-1.68-.22-2.11a2 2 0 0 0-.87-.87C19.48 4 18.92 4 17.8 4H6.2c-1.12 0-1.68 0-2.11.22-.38.19-.68.5-.87.87C3 5.52 3 6.08 3 7.2v11.47c0 1.07 0 1.6.22 1.87.19.24.48.38.78.38.35 0 .77-.33 1.6-1Z" />;
    case 'creator': return <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /><path d="m17.7 6.3-2.1 2.1" /></>;
    case 'profile': return <path d="M17.22 19.33A7 7 0 0 0 12 17a7 7 0 0 0-5.22 2.33M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />;
    case 'library': return <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M11 8h6M11 12h6M11 16h4" /></>;
    case 'settings': return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.4.3.7.6 1 .3.2.7.4 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>;
    case 'info': return <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>;
    case 'help': return <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.4 1.1-1.4 2.3M12 17h.01" /></>;
    case 'cloud': return <path d="M6.5 18h10.8a3.7 3.7 0 0 0 .4-7.4A5.8 5.8 0 0 0 6.8 8.7 4.7 4.7 0 0 0 6.5 18Z" />;
    case 'shield': return <><path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>;
    case 'image': return <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 3.5 3.5 2-2L20 19" /></>;
    case 'upload': return <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 14v5h14v-5" /></>;
    case 'compass': return <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" /></>;
    case 'search': return <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></>;
    case 'close': return <path d="m6 6 12 12M18 6 6 18" />;
    case 'bell': return <path d="M15 17v1a3 3 0 0 1-6 0v-1m6 0H5.41c-.38 0-.58 0-.73-.05a1 1 0 0 1-.63-.63C4 16.16 4 15.97 4 15.59c0-.17 0-.26.01-.34.03-.15.09-.3.18-.42.05-.07.11-.13.23-.25l.38-.38a.68.68 0 0 0 .2-.48V10a7 7 0 1 1 14 0v3.72c0 .18.07.35.2.48l.39.38c.12.12.18.18.22.25.09.12.15.27.18.42.01.08.01.17.01.34 0 .38 0 .57-.05.73a1 1 0 0 1-.63.63c-.15.05-.35.05-.73.05H15Z" />;
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
    case 'send': return <path d="m10.31 13.69 4.84-4.84M20.11 5.89l-4.09 13.29c-.37 1.19-.55 1.79-.87 1.99-.27.17-.61.2-.91.07-.34-.14-.62-.7-1.18-1.81l-2.59-5.18c-.09-.18-.13-.27-.19-.35a1.36 1.36 0 0 0-.51-.37l-5.2-2.59C3.46 10.38 2.9 10.1 2.76 9.76a1 1 0 0 1 .07-.91c.2-.32.8-.5 1.99-.87l13.29-4.09c.94-.29 1.41-.43 1.72-.32.28.1.5.32.6.6.11.31-.03.78-.32 1.72Z" />;
    case 'clock': return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
    case 'lock': return <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>;
    case 'maximize': return <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5" /></>;
  }
}
