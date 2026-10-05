import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev-only preview harness (`npm run harness`). It serves harness/index.html
 * (the stand-in host) and harness/frame.html (the plugin iframe) and is never
 * part of the production build, which keeps using the root vite.config.ts and
 * the root index.html.
 */
const harnessDir = decodeURIComponent(new URL('.', import.meta.url).pathname);
const pluginDir = decodeURIComponent(new URL('..', import.meta.url).pathname);

export default defineConfig({
  root: harnessDir,
  base: './',
  plugins: [react()],
  // Keep Vite's dependency cache out of harness/.
  cacheDir: `${pluginDir}node_modules/.vite-harness`,
  publicDir: false,
  server: {
    port: 5179,
    fs: {
      allow: [pluginDir],
    },
  },
});
