/// <reference types="vite/client" />

import type { NightWatchBridge } from '@shared/ipc';

declare global {
  interface Window {
    /** Typed IPC bridge injected by electron/preload.ts. */
    nightwatch: NightWatchBridge;
  }
}

export {};
