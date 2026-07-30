import { createServer, type Server } from "node:http";
import { createNodeRuntimeMetrics } from "@radar/observability";
import { workerRuntimeStatus } from "../../application/workerRuntimeStatus.js";

const DEFAULT_PORT = 3010;

function readProbeHost(): string {
  const host = process.env.WORKER_PROBE_HOST?.trim();
  return host && host.length > 0 ? host : "127.0.0.1";
}

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
  const host = readProbeHost();
  const metrics = createNodeRuntimeMetrics({
    service: "worker",
    role: process.env.RADAR_WORKER_ROLE?.trim() || "unknown",
  });

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      try {
        const body = await metrics.snapshot();
        res.writeHead(200, {
          "Content-Type": metrics.contentType,
          "Cache-Control": "no-store",
        });
        res.end(body);
      } catch (error) {
        console.error("Worker metrics:", error);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("metrics unavailable");
      }
      return;
    }

    if (req.method === "GET" && (req.url === "/status" || req.url === "/health")) {
      const snapshot = workerRuntimeStatus.snapshot();
      const statusCode =
        req.url === "/health" && snapshot.status !== "running" ? 503 : 200;
      const body = JSON.stringify(snapshot);
      res.writeHead(statusCode, {
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

  server.listen(port, host, () => {
    enabled = true;
    console.log(`Worker probe: http://${host}:${port}/status`);
  });

  return { port, server, enabled };
}
