import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/** Keep desktop-only Picker markup out and publish the static installer page. */
function preparePublicSite(): PluginOption {
  return {
    name: 'nightwatch-public-site-assets',
    closeBundle() {
      const picker = path.resolve(__dirname, 'dist-web', 'picker.html');
      if (fs.existsSync(picker)) {
        fs.rmSync(picker);
      }

      const installerSource = path.resolve(__dirname, 'docs', 'installer-site');
      const installerTarget = path.resolve(__dirname, 'dist-web', 'installer');
      if (fs.existsSync(installerSource)) {
        fs.rmSync(installerTarget, { recursive: true, force: true });
        fs.cpSync(installerSource, installerTarget, { recursive: true });
        // README is useful in the repository but is not a public page asset.
        fs.rmSync(path.resolve(installerTarget, 'README.md'), { force: true });
      }
    },
  };
}

/**
 * Normal NightWatch browser build for Vercel and other public static hosts.
 * This intentionally uses index.html/main.tsx rather than the Discord
 * Activity entry (index.discord.html/main.discord.tsx), so a normal browser
 * never requires Discord's frame_id query parameter.
 */
export default defineConfig({
  plugins: [react(), preparePublicSite()],
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
      input: path.resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 5173,
  },
});
