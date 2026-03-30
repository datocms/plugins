import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
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
})

