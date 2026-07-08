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
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'";
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
            rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } },
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
    sourcemap: true,
  },
});
