/// <reference types="vite/client" />

import type { NightWatchBridge } from '@shared/ipc';

declare global {
  interface Window {
    /** Typed IPC bridge injected by electron/preload.ts. */
    nightwatch: NightWatchBridge;
  }

  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
