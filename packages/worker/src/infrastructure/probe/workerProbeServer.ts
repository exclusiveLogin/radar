import { createServer, type Server } from "node:http";
import { workerRuntimeStatus } from "../../application/workerRuntimeStatus.js";

const DEFAULT_PORT = 3010;

function readProbePort(): number {
  const raw = process.env.WORKER_PROBE_PORT?.trim();
  const port = raw ? Number(raw) : DEFAULT_PORT;
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
}

export type WorkerProbeHandle = {
  port: number;
  server: Server | null;
  enabled: boolean;
};

/**
 * Мини HTTP probe worker: GET /status → JSON runtime-снимок.
 * Порт: WORKER_PROBE_PORT (default 3010). API проксирует через GET /api/worker/status.
 * При EADDRINUSE worker продолжает работу (часто — второй экземпляр / tsx watch).
 */
export function startWorkerProbeServer(): WorkerProbeHandle {
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

  let enabled = false;

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(
        `Worker probe: порт ${port} занят (EADDRINUSE) — probe отключён, ingest/geo продолжают работу. ` +
          "Закрой старый worker или: node scripts/free-dev-ports.mjs",
      );
      return;
    }
    console.error("Worker probe:", err);
  });

  server.listen(port, "127.0.0.1", () => {
    enabled = true;
    console.log(`Worker probe: http://127.0.0.1:${port}/status`);
  });

  return { port, server, enabled };
}
