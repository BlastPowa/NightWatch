import { useEffect } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { useWindowState } from '@/hooks/useWindowState';

interface TitleBarProps {
  /** Optional context line, e.g. the room you are currently in. */
  subtitle?: string;
}

/**
 * Desktop title bar (Phase 21).
 *
 * We draw the brand and the drag region; Windows draws the minimize/maximize/
 * close buttons through titleBarOverlay. That split is deliberate — Snap
 * Layouts needs Windows to own the maximize button (it answers WM_NCHITTEST
 * with HTMAXBUTTON, which a renderer cannot do), so hand-drawn HTML controls
 * would look identical while silently costing Snap Layouts, keyboard access,
 * and high-contrast theming.
 *
 * Renders nothing off desktop: the Discord Activity sits inside Discord's own
 * frame and a browser tab has no window to control.
 */
export function TitleBar({ subtitle }: TitleBarProps): JSX.Element | null {
  const windowState = useWindowState();
  const height = windowState?.height ?? 0;

  // The bar is fixed, so the app shell below it has to reserve the space. Doing
  // that through a custom property keeps the existing .app flex layout intact
  // rather than restructuring it into a grid.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--nw-titlebar-h', `${height}px`);
    return () => {
      root.style.removeProperty('--nw-titlebar-h');
    };
  }, [height]);

  if (windowState === null) {
    return null;
  }

  return (
    <header
      className={`title-bar${windowState.isMaximized ? ' is-maximized' : ''}`}
      style={{ height: `${windowState.height}px` }}
    >
      <div className="title-bar-brand">
        <BrandMark className="title-bar-mark" />
        <span className="title-bar-name">NightWatch</span>
        {subtitle !== undefined && subtitle !== '' ? (
          <span className="title-bar-subtitle">{subtitle}</span>
        ) : null}
      </div>
    </header>
  );
}
