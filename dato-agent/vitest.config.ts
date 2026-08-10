import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
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
  },
});
