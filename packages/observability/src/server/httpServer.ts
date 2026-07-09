import { createServer, type Server } from "node:http";
import {
  obsIngestBatchSchema,
  runtimeObservabilitySnapshotSchema,
} from "@radar/shared";
import type { SqlObservabilityStore } from "../store/sqlObservabilityStore.js";

export type ObsHttpServerHandle = {
  port: number;
  server: Server;
};

/** Чтение JSON body из HTTP request. */
async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

/** Node HTTP server obs-service: health, ingest, snapshot. */
export function createObsHttpServer(
  store: SqlObservabilityStore,
  port: number,
  host = "0.0.0.0",
): ObsHttpServerHandle {
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url?.split("?")[0] ?? "";

      if (req.method === "GET" && (url === "/health" || url === "/")) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "GET" && url === "/obs/v1/runtime/snapshot") {
        const snapshot = await store.loadRuntimeSnapshot();
        const validated = runtimeObservabilitySnapshotSchema.parse(snapshot);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(validated));
        return;
      }

      if (req.method === "POST" && url === "/obs/v1/ingest/batch") {
        const body = await readJsonBody(req);
        const batch = obsIngestBatchSchema.parse(body);
        await store.applyIngestBatch(batch);
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    })().catch((err: unknown) => {
      console.error("[obs-http]", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    });
  });

  server.listen(port, host, () => {
    console.log(`[obs-http] listening on http://${host}:${port}`);
  });

  return { port, server };
}
