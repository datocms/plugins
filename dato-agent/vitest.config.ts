import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { recordCommentsAliases } from './configAliases';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: recordCommentsAliases,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Live tests hit real APIs; they run only through vitest.live.config.ts.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
