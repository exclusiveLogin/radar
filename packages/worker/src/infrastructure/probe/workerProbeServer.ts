import { createServer, type Server } from "node:http";
import { workerRuntimeStatus } from "../../application/workerRuntimeStatus.js";

const DEFAULT_PORT = 3010;

function readProbePort(): number {
  const raw = process.env.WORKER_PROBE_PORT?.trim();
  const port = raw ? Number(raw) : DEFAULT_PORT;
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
}

/**
 * Мини HTTP probe worker: GET /status → JSON runtime-снимок.
 * Порт: WORKER_PROBE_PORT (default 3010). API проксирует через GET /api/worker/status.
 */
export function startWorkerProbeServer(): { port: number; server: Server } {
  const port = readProbePort();

  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/status" || req.url === "/health")) {
      const body = JSON.stringify(workerRuntimeStatus.snapshot());
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Worker probe: http://127.0.0.1:${port}/status`);
  });

  return { port, server };
}
