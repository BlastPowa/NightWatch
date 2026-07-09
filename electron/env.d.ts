/** Vite-injected env vars available in the main/preload builds. */
interface ImportMetaEnv {
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
