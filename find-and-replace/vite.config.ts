import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // react-ui imports directories of its dependencies, which only a bundler
    // resolves: let Vite transform it instead of Node.
    server: { deps: { inline: ['datocms-react-ui'] } },
  },
});
