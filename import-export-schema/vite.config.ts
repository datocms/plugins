import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    base: './',
    plugins: [
      react(),
      // SVGR for SVG imports
      svgr({ svgrOptions: {} }),
    ],
    resolve: {
      alias: [
        {
          find: '@',
          replacement: fileURLToPath(new URL('./src', import.meta.url)),
        },
      ],
    },
    build: {
      sourcemap: false,
      cssCodeSplit: true,
      // No manual chunks: the lazy entrypoints already split the bundle. The
      // boot chunk holds React, the SDK and the Canvas, and the graph
      // libraries (@xyflow/react, d3) load only with the export and import
      // pages. Named vendor chunks put React in the xyflow chunk, so every
      // page preloaded xyflow.
      chunkSizeWarningLimit: 1024,
    },
    // Drop consoles/debuggers in production bundles
    esbuild: isBuild ? { drop: ['console', 'debugger'] } : undefined,
  };
});
