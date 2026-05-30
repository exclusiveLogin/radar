#!/usr/bin/env node
/**
 * Smoke: composition root db mode — DataSource, OutboxRelay, orchestrator start/stop.
 * Требует Postgres + .env (DATABASE_URL, RADAR_STORAGE_MODE=db).
 */
import "reflect-metadata";
import { MONOREPO_ROOT } from "../src/shims/monorepo-root.ts";
import { loadRootEnv } from "../src/infrastructure/config/loadRootEnv.js";
import { createWorkerCompositionRoot } from "../src/application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../src/infrastructure/persistence/storageMode.js";

loadRootEnv(MONOREPO_ROOT);

const runtime = await createWorkerCompositionRoot({
  storageMode: WorkerStorageMode.Db,
});

console.log("[bootstrap] storageMode:", runtime.storageMode);
console.log("[bootstrap] ingestOrchestrator:", Boolean(runtime.ingestOrchestrator));
console.log("[bootstrap] backfillDaemon:", Boolean(runtime.backfillDaemon));

if (!runtime.ingestOrchestrator) {
  throw new Error("ingestOrchestrator missing in db mode");
}

await runtime.ingestOrchestrator.start();
console.log("[bootstrap] IngestOrchestrator.start() OK");

await new Promise((r) => setTimeout(r, 2000));

await runtime.ingestOrchestrator.stop();
await new Promise((r) => setTimeout(r, 500));
await runtime.shutdown?.();
console.log("[bootstrap] shutdown OK");
