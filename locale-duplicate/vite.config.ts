import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite configuration for the DatoCMS Locale Duplicate plugin.
 * 
 * Configuration:
 * - base: './' - Ensures assets are loaded relative to the HTML file
 * - plugins: React plugin for JSX transformation and Fast Refresh
 * 
 * The build output is a single index.html file that gets loaded
 * as an iframe within the DatoCMS interface.
 * 
 * @see https://vitejs.dev/config/
 */
export default defineConfig({
  base: './',
  plugins: [react()],
})
