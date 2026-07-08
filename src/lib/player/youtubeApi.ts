/**
 * Loader for the official YouTube IFrame Player API (compliance:
 * playback always goes through this API — see CLAUDE.md COMPLIANCE).
 * Idempotent: the script is injected once and all callers share the
 * same promise.
 */

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';

let apiPromise: Promise<typeof YT> | null = null;

export function loadYouTubeApi(): Promise<typeof YT> {
  if (apiPromise !== null) {
    return apiPromise;
  }

  apiPromise = new Promise<typeof YT>((resolve, reject) => {
    const existing = window.YT;
    if (existing && typeof existing.Player === 'function') {
      resolve(existing);
      return;
    }

    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube IFrame API loaded but YT global is missing.'));
      }
    };

    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Failed to load the YouTube IFrame API script.'));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}
