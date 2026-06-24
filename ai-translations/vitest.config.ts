import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live in src/. Scope the include here so Vitest's default glob
    // (which matches **/*.{test,spec}.*) never claims Playwright specs under e2e/.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'html'],
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
    },
  },
});
