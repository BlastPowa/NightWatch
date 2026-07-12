import { useEffect, useState } from 'react';
import type { WindowState } from '@shared/ipc';
import { getPlatformBridge } from '@/platform/PlatformBridge';

/**
 * Desktop window chrome state, or null on any platform that does not own its
 * window (the Discord Activity, a browser tab). Null means "render no chrome" —
 * not "render disabled chrome".
 */
export function useWindowState(): WindowState | null {
  const [state, setState] = useState<WindowState | null>(null);

  useEffect(() => {
    let active = true;
    const bridge = getPlatformBridge();

    void bridge.getWindowState().then((initial) => {
      if (active) {
        setState(initial);
      }
    });

    const unsubscribe = bridge.onWindowState((next) => {
      if (active) {
        setState(next);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
