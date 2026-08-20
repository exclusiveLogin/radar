import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import { createObsHttpServer } from "./server/httpServer.js";
import { startStaleCleanupLoop } from "./server/staleCleanupLoop.js";
import { SqlObservabilityStore } from "./store/sqlObservabilityStore.js";

/** Загрузка .env из корня монорепы. */
function loadEnv(): void {
  const root = path.resolve(__dirname, "../../..");
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

function readPort(): number {
  const raw = process.env.PORT?.trim() ?? process.env.OBS_PORT?.trim() ?? "3020";
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : 3020;
}

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for obs-service");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const store = new SqlObservabilityStore(pool);
  const port = readPort();
  const host = process.env.OBS_HOST?.trim() || "0.0.0.0";

  const http = createObsHttpServer(store, port, host);
  const staleLoop = startStaleCleanupLoop(store);

  const shutdown = async () => {
    staleLoop.stop();
    http.server.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
