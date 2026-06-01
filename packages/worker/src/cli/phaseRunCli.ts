/**
 * Запуск фазы по phase_id (ADR-003 v2). Алиас: worker:enrich:run -- --stage= → --phase=
 *
 * Usage:
 *   npm run worker:phase:run -- --phase=llm --batch=100 [--watch]
 *   npm run worker:phase:run -- --phase=catalog --from=2024-01-01 --limit=50
 */
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createProgress } from "./progress.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runPhaseCli(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const phaseId =
    readStringFlag(map, ["phase", "stage"])?.trim() ??
    (() => {
      console.error("worker:phase:run: нужен --phase=<id> (catalog|llm|dadata|nominatim)");
      process.exit(1);
    })();

  const batchSize = Number(readStringFlag(map, ["batch", "batch-size"]) ?? "100");
  const watch = hasAnyFlag(map, ["watch"]);
  const watchIdleMs = Number(readStringFlag(map, ["watch-idle-ms"]) ?? "5000");

  const runtime = await createWorkerCompositionRoot({ storageMode: WorkerStorageMode.Db });
  if (!runtime.dataSource || !runtime.phaseRunner || !runtime.workerRepos) {
    console.error("worker:phase:run: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const repos = runtime.workerRepos;
  const phase = await repos.phaseDefinitions.findById(phaseId);
  if (!phase) {
    console.error(`Фаза '${phaseId}' не найдена. npm run phase:manifest:import`);
    process.exit(1);
  }

  const manualScope = {
    fromPostedAt: readStringFlag(map, ["from", "from-posted-at"]),
    toPostedAt: readStringFlag(map, ["to", "to-posted-at"]),
    limit: Number(readStringFlag(map, ["limit"]) ?? "0") || undefined,
    tail: hasAnyFlag(map, ["tail"]),
  };

  const rawIds = await repos.phaseRuns.findRawIdsForManualRun(phaseId, manualScope);
  if (rawIds.length > 0) {
    for (const rawMessageId of rawIds) {
      await repos.phaseCoverage.enqueuePending({ rawMessageId, phaseId });
    }
  }

  console.log(`phase:run phase=${phaseId} batch=${batchSize} watch=${watch}`);
  const initial = await repos.phaseCoverage.countByStatus(phaseId);
  console.log(`coverage[${phaseId}]: ${JSON.stringify(initial)}`);

  let ok = 0;
  let failed = 0;
  const progress = createProgress(`phase:${phaseId}`, watch ? 0 : initial.pending);

  for (;;) {
    const stats = await runtime.phaseRunner.runPhaseTick({
      phase,
      trigger: "manual",
      batchSize,
    });
    ok += stats.ok;
    failed += stats.failed;
    progress.tick(stats.processed, { ok, failed });

    if (stats.claimed === 0) {
      if (!watch) break;
      await sleep(watchIdleMs);
      continue;
    }
    if (!watch) continue;
  }

  progress.stop();
  const finalCounts = await repos.phaseCoverage.countByStatus(phaseId);
  console.log(`\nphase:run[${phaseId}] ok=${ok} failed=${failed}; coverage=${JSON.stringify(finalCounts)}`);
  await runtime.shutdown?.();
}

runPhaseCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
