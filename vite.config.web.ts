import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/** Static hosts serve index.html at / — rename the Discord entry file. */
function renameEntryHtml(): PluginOption {
  return {
    name: 'nightwatch-rename-entry-html',
    closeBundle() {
      const from = path.resolve(__dirname, 'dist-web', 'index.discord.html');
      const to = path.resolve(__dirname, 'dist-web', 'index.html');
      if (fs.existsSync(from)) {
        fs.renameSync(from, to);
      }
    },
  };
}

/**
 * Discord Activity / web build (Phase 13): renderer only, no Electron
 * main/preload. No CSP meta — Discord's Activity proxy enforces its own
 * policy, and all external hosts are reached via patchUrlMappings.
 * Output deploys to static hosting (Cloudflare Pages).
 */
export default defineConfig({
  plugins: [react(), renameEntryHtml()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: 'dist-web',
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.discord.html'),
    },
  },
  server: {
    port: 5174,
  },
});
