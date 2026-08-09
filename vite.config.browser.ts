import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/** Keep desktop-only Picker markup out of the public browser bundle. */
function removeDesktopPicker(): PluginOption {
  return {
    name: 'nightwatch-remove-desktop-picker',
    closeBundle() {
      const picker = path.resolve(__dirname, 'dist-web', 'picker.html');
      if (fs.existsSync(picker)) {
        fs.rmSync(picker);
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
  plugins: [react(), removeDesktopPicker()],
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
