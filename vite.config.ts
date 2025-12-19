import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Increase limit to silence bundle size warning from pixi + rtc deps
    chunkSizeWarningLimit: 1200,
  },
});
