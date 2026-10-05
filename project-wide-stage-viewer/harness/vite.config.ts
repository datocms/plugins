import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A local preview of the plugin's screens with a mock ctx and mock API data.
// `npm run harness`, then open http://localhost:5287/?surface=page&scheme=dark
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: [
      // The screens import '../lib/cma'; the harness swaps in a fake client.
      {
        find: /^\.\.\/lib\/cma$/,
        replacement: path.resolve(__dirname, 'cma.ts'),
      },
    ],
  },
  server: { port: 5287, strictPort: true },
});
