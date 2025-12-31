import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**/*', 'node_modules/**/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/**/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/entrypoints/components', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/entrypoints/hooks', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/entrypoints/utils', import.meta.url)),
      '@ctypes': fileURLToPath(new URL('./src/entrypoints/types', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/entrypoints/styles', import.meta.url)),
    },
  },
});
