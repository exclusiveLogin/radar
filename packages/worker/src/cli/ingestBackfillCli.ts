import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const providerId = readStringFlag(map, ["provider-id", "providerId"]);
  const bindingId = readStringFlag(map, ["binding-id", "bindingId"]);
  const batchSizeStr = readStringFlag(map, ["batch-size", "batchSize"]);
  const batchSize = batchSizeStr ? Number(batchSizeStr) : undefined;

  if (!providerId || !bindingId) {
    console.error(
      "Usage: ingestBackfillCli --provider-id=<uuid> --binding-id=<uuid> [--batch-size=200]",
    );
    process.exit(1);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
  });

  if (!runtime.ingestOrchestrator) {
    console.error("Ingest orchestrator доступен только в RADAR_STORAGE_MODE=db.");
    process.exit(1);
  }

  const stats = await runtime.ingestOrchestrator.runBackfillChunk({
    providerId,
    bindingId,
    batchSize,
    fromPostedAt: readStringFlag(map, ["from-posted-at", "fromPostedAt"]),
    toPostedAt: readStringFlag(map, ["to-posted-at", "toPostedAt"]),
    fromExternalId: readStringFlag(map, ["from-external-id", "fromExternalId"]),
    toExternalId: readStringFlag(map, ["to-external-id", "toExternalId"]),
  });

  console.log("Backfill chunk:", stats);
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
