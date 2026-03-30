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
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-datocms': ['datocms-plugin-sdk', 'datocms-react-ui'],
            'vendor-xyflow': ['@xyflow/react', 'd3-hierarchy', 'd3-timer'],
            'vendor-icons': [
              '@fortawesome/react-fontawesome',
              '@fortawesome/fontawesome-svg-core',
              '@fortawesome/free-solid-svg-icons',
            ],
            'vendor-lodash': ['lodash-es'],
          },
        },
      },
    },
    // Drop consoles/debuggers in production bundles
    esbuild: isBuild ? { drop: ['console', 'debugger'] } : undefined,
  };
});
