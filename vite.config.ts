import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

/**
 * Injects the production Content-Security-Policy at build time only.
 * The dev server is excluded because @vitejs/plugin-react requires an
 * inline preamble script during development.
 */
function productionCsp(): PluginOption {
  const csp =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com https://www.google.com https://apis.google.com blob:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https://i.ytimg.com https://*.googleusercontent.com https://*.ggpht.com https://cdn.discordapp.com https://media.discordapp.net; " +
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
    "child-src https://www.youtube.com blob:; " +
    "worker-src blob:; " +
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.youtube.com https://*.googlevideo.com https://*.youtube.com https://*.google.com";
  return {
    name: 'nightwatch-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<title>',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <title>`,
      );
    },
  };
}

export default defineConfig({
  plugins: [
    productionCsp(),
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            alias: { '@shared': path.resolve(__dirname, 'shared') },
          },
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              external: ['bufferutil', 'utf-8-validate'],
              output: { format: 'cjs', entryFileNames: '[name].js' },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          resolve: {
            alias: { '@shared': path.resolve(__dirname, 'shared') },
          },
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: 'dist',
    // No renderer sourcemaps in production builds (smaller installer,
    // no source exposure); dev uses the dev server anyway.
    sourcemap: false,
  },
});
