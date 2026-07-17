import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { createProgress } from "./progress.js";
import {
  hasAnyFlag,
  parseLongFlagsMap,
  readStringFlag,
} from "./workerCliArgs.js";

type BackfillChunkInput = {
  providerId: string;
  bindingId: string;
  batchSize?: number;
  fromPostedAt?: string;
  toPostedAt?: string;
  fromExternalId?: string;
  toExternalId?: string;
};

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const allBindings = hasAnyFlag(map, ["all-bindings", "allBindings", "all"]);
  const providerId = readStringFlag(map, ["provider-id", "providerId"]);
  const bindingId = readStringFlag(map, ["binding-id", "bindingId"]);
  const batchSizeStr = readStringFlag(map, ["batch-size", "batchSize"]);
  const batchSize = batchSizeStr ? Number(batchSizeStr) : undefined;

  const range: Omit<BackfillChunkInput, "providerId" | "bindingId"> = {
    batchSize,
    fromPostedAt: readStringFlag(map, ["from-posted-at", "fromPostedAt"]),
    toPostedAt: readStringFlag(map, ["to-posted-at", "toPostedAt"]),
    fromExternalId: readStringFlag(map, ["from-external-id", "fromExternalId"]),
    toExternalId: readStringFlag(map, ["to-external-id", "toExternalId"]),
  };

  if (!allBindings && (!providerId || !bindingId)) {
    console.error(
      "Usage: ingestBackfillCli (--all-bindings | --provider-id=<uuid> --binding-id=<uuid>) [--batch-size=200]",
    );
    process.exit(1);
  }

  const runtime = await createWorkerCompositionRoot({
    workerRole: "ingest",
    bootCaps: ["ingest"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });

  if (!runtime.ingestOrchestrator || !runtime.dataSource) {
    console.error("Ingest orchestrator доступен только в RADAR_STORAGE_MODE=db.");
    process.exit(1);
  }

  let totalInserted = 0;
  let totalDuplicates = 0;
  const progress = createProgress("backfill", 0);

  const onIngest = (result: { inserted: boolean }): void => {
    if (result.inserted) totalInserted += 1;
    else totalDuplicates += 1;
    progress.tick(1, { inserted: totalInserted, dups: totalDuplicates });
  };

  try {
    if (allBindings) {
      const db = await createWorkerDbRepositories(runtime.dataSource);
      const bindings = await db.ingestBindings.listEnabled();
      if (bindings.length === 0) {
        console.warn("Нет enabled bindings для backfill.");
        return;
      }

      for (const binding of bindings) {
        await runtime.ingestOrchestrator.runBackfillChunk({
          providerId: binding.providerId,
          bindingId: binding.id,
          ...range,
          onIngest,
        });
      }

      progress.stop();
      console.log("Backfill all:", {
        bindings: bindings.length,
        inserted: totalInserted,
        duplicates: totalDuplicates,
      });
      return;
    }

    const stats = await runtime.ingestOrchestrator.runBackfillChunk({
      providerId: providerId!,
      bindingId: bindingId!,
      ...range,
      onIngest,
    });
    progress.stop();
    console.log("Backfill chunk:", stats);
  } finally {
    await runtime.shutdown?.();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
