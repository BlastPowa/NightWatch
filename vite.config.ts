import path from 'node:path';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import electronBuild from 'vite-plugin-electron';

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
    // Phase 29: the <video> element plays authorized local/Drive media from the
    // private nightwatch-media:// scheme. Narrowly media-src only — the scheme
    // is registered without bypassCSP precisely so this is the whole allowance.
    "media-src 'self' nightwatch-media: blob:; " +
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

const PUBLIC_MEDIA_CONFIG = [
  'NIGHTWATCH_ENABLE_LOCAL_FILES',
  'NIGHTWATCH_ENABLE_DRIVE',
  'NIGHTWATCH_ENABLE_LIBRARY',
  'NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT',
  'NIGHTWATCH_GOOGLE_CLIENT_ID',
  'NIGHTWATCH_GOOGLE_PICKER_API_KEY',
  'NIGHTWATCH_GOOGLE_APP_ID',
  'NIGHTWATCH_MAX_MEDIA_BYTES',
] as const;

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const mediaDefines = Object.fromEntries(
    PUBLIC_MEDIA_CONFIG.map((name) => [
      `__${name}__`,
      JSON.stringify(process.env[name] ?? fileEnv[name] ?? ''),
    ]),
  );

  return {
  plugins: [
    productionCsp(),
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          define: mediaDefines,
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
    // The simple plugin deliberately inlines a preload into one chunk, which
    // means Rollup cannot accept two preload inputs in the same build. Build
    // the isolated Picker preload as its own single-entry Electron bundle.
    electronBuild({
      entry: 'electron/media/pickerPreload.ts',
      onstart({ reload }) {
        reload();
      },
      vite: {
        resolve: {
          alias: { '@shared': path.resolve(__dirname, 'shared') },
        },
        build: {
          outDir: 'dist-electron',
          sourcemap: true,
          emptyOutDir: false,
          rollupOptions: {
            output: {
              format: 'cjs',
              entryFileNames: 'pickerPreload.js',
              inlineDynamicImports: true,
            },
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
  };
});
