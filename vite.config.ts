import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // ffmpeg.wasm and transformers.js ship their own workers/wasm; don't pre-bundle them
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/core", "@huggingface/transformers"],
  },
  worker: { format: "es" },
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
