/**
 * Loader for the official YouTube IFrame Player API (compliance:
 * playback always goes through this API — see CLAUDE.md COMPLIANCE).
 * Idempotent: all callers share one in-flight promise and one script tag.
 */

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';
const API_TIMEOUT_MS = 12_000;
const OWNED_SCRIPT_ATTRIBUTE = 'data-nightwatch-youtube-api';

let apiPromise: Promise<typeof YT> | null = null;

function readyApi(): typeof YT | null {
  const candidate = window.YT;
  return candidate && typeof candidate.Player === 'function' ? candidate : null;
}

function findExistingScript(): HTMLScriptElement | null {
  return Array.from(document.scripts).find((script) => script.src === API_URL) ?? null;
}

export function loadYouTubeApi(): Promise<typeof YT> {
  const ready = readyApi();
  if (ready !== null) return Promise.resolve(ready);
  if (apiPromise !== null) return apiPromise;

  apiPromise = new Promise<typeof YT>((resolve, reject) => {
    let settled = false;
    let script = findExistingScript();
    const createdByNightWatch = script === null;
    if (script === null) {
      script = document.createElement('script');
      script.src = API_URL;
      script.async = true;
      script.setAttribute(OWNED_SCRIPT_ATTRIBUTE, 'true');
    }

    const previousCallback = window.onYouTubeIframeAPIReady;
    let timeoutId: number | null = null;

    function cleanup(): void {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
      if (window.onYouTubeIframeAPIReady === handleApiReady) {
        window.onYouTubeIframeAPIReady = previousCallback;
      }
    }

    function succeedIfReady(): boolean {
      const loaded = readyApi();
      if (loaded === null || settled) return false;
      settled = true;
      cleanup();
      resolve(loaded);
      return true;
    }

    function fail(message: string): void {
      if (settled) return;
      settled = true;
      cleanup();
      apiPromise = null;
      if (script?.getAttribute(OWNED_SCRIPT_ATTRIBUTE) === 'true') {
        script.remove();
      }
      reject(new Error(message));
    }

    function handleApiReady(): void {
      try {
        previousCallback?.();
      } finally {
        if (!succeedIfReady()) {
          fail('YouTube IFrame API loaded but YT.Player is unavailable.');
        }
      }
    }

    function handleLoad(): void {
      // Some Chromium/Electron builds expose YT.Player before the global
      // callback executes. Resolve immediately when that happens, otherwise
      // keep waiting for the official callback until the timeout expires.
      void succeedIfReady();
    }

    function handleError(): void {
      fail('Failed to load the YouTube IFrame API script.');
    }

    window.onYouTubeIframeAPIReady = handleApiReady;
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    timeoutId = window.setTimeout(() => {
      fail('Timed out while loading the YouTube IFrame API.');
    }, API_TIMEOUT_MS);

    // The script can become ready between the initial check and listener setup.
    if (succeedIfReady()) return;
    if (createdByNightWatch) document.head.appendChild(script);
  });

  return apiPromise;
}
