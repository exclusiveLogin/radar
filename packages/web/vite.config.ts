import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  /** VITE_* из корневого `.env` монорепы. */
  envDir: repoRoot,
  plugins: [react()],
  resolve: {
    alias: {
      // Только zod-схемы: главный barrel тянет node:crypto/node:util и ломает браузер.
      "@radar/shared": path.resolve(__dirname, "../shared/src/schemas/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
