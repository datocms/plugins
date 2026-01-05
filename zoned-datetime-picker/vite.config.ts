import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    // Ensure a single React copy across deps... datacms-plugin-sdk is still <=18 for now
    // Without this, we see useEffect errors
    dedupe: ["react", "react-dom"],
  },
});
