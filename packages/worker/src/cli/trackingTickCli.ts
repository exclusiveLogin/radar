/**
 * Один тик TrackingRebuildDaemon (диагностика / ручной прогон).
 */
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { TrackingRebuildDaemon } from "../application/tracking/trackingRebuildDaemon.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
    workerRole: "tracking",
  });
  const ds = runtime.dataSource;
  if (!ds) {
    console.error("Нет dataSource");
    process.exit(1);
  }

  const daemon = new TrackingRebuildDaemon(ds);
  try {
    await daemon.runOnce();
    console.log("[tracking:tick] ok");
  } catch (err) {
    console.error("[tracking:tick] failed:", err);
    process.exit(1);
  } finally {
    await runtime.shutdown?.();
  }
}

void main();
