import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "../..");
const apiProxyTarget = process.env.VITE_DEV_PROXY_API ?? "http://127.0.0.1:3000";
const tilesProxyTarget =
  process.env.VITE_DEV_PROXY_TILES ?? "http://127.0.0.1:8081";
const apiWsTarget = apiProxyTarget.replace(/^http/, "ws");

/** Прокси /tiles → TileServer (dev + preview). */
const tilesProxy = {
  target: tilesProxyTarget,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/tiles/, ""),
};

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
    /** Слушаем все интерфейсы (LAN + туннель на этой машине). */
    host: true,
    port: 5173,
    strictPort: true,
    /**
     * CloudPub: каждая сессия — новый xxx.cloudpub.ru.
     * Vite 6 без этого режет Host («Blocked request»). URL в .env не нужен.
     */
    allowedHosts: [".cloudpub.ru"],
    /**
     * Прокси на локальный API — всегда 127.0.0.1, не CloudPub URL.
     * Запрос: браузер → https://xxx.cloudpub.ru/api → CloudPub → Vite:5173 → API:3000.
     * WS в приложении: location.host/ws (уже так в ws.ts).
     */
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: apiWsTarget,
        ws: true,
        changeOrigin: true,
      },
      "/tiles": tilesProxy,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/tiles": tilesProxy,
    },
  },
});
