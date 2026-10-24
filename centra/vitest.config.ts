import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
    // react-ui imports directories of its dependencies, which only a bundler
    // resolves: let Vite transform it instead of Node.
    server: { deps: { inline: ['datocms-react-ui'] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
