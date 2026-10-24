import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    server: {
      deps: {
        // react-ui imports directories of its dependencies, which only a
        // bundler resolves: let Vite transform it instead of Node.
        inline: ['datocms-react-ui'],
      },
    },
    coverage: {
      reporter: ['text', 'html'],
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
    },
  },
});
