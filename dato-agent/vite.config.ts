import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { recordCommentsAliases } from './configAliases';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: recordCommentsAliases,
  },
  server: {
    allowedHosts: true,
  },
});
