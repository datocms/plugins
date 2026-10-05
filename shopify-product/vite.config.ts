import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Each screen is its own chunk (src/utils/mount.ts). datocms-react-ui's
        // Dropdown/index.js re-exports Menu and Option, which import the
        // package root back, so Rollup warns about a cycle across chunks. It
        // imports them directly instead: the emitted chunks have no static
        // cycle, and these modules read no import while evaluating. Grouping
        // the kit in a manual chunk would pull React and react-select into it.
        if (
          warning.code === 'CYCLIC_CROSS_CHUNK_REEXPORT' &&
          warning.exporter?.includes('/datocms-react-ui/')
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
