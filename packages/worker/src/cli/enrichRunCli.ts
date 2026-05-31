/**
 * ---
 * layer: worker/cli
 * kind: enrichment-consumer
 * purpose: Фоновое порционное гео-обогащение: догоняет catalog-only события полным пайплайном.
 * ---
 *
 * Берёт пачку задач из enrichment_queue, прогоняет полный geo-пайплайн
 * (llm/dadata/nominatim по env/CLI), ре-валидирует и обновляет parsed_events/
 * event_locations через тот же ParseRawMessageHandler. Re-эмит MessageParsed
 * пересчитывает проекцию карты; enqueue при этом идемпотентен (no-op).
 *
 * Usage:
 *   RADAR_LLM_GEOCODER_ENABLED=1 npm run worker:enrich:run -- --batch=100 [--watch]
 *     [--enrich-llm] [--enrich-dadata] [--enrich-nominatim] [--pipeline-order=catalog,llm,dadata,nominatim]
 */
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import {
  DEFAULT_PIPELINE_ORDER,
  resolveEnricherFlagsFromEnv,
  resolvePipelineOrderFromEnv,
  type ResolvedEnricherFlags,
} from "../infrastructure/enrichers/enricherChainFactory.js";
import { createProgress } from "./progress.js";
import {
  hasAnyFlag,
  parseLongFlagsMap,
  parsePipelineOrder,
  readStringFlag,
} from "./workerCliArgs.js";

/** Флаги энричеров: env как база, CLI-флаги включают поверх. */
function resolveConsumerFlags(map: ReturnType<typeof parseLongFlagsMap>): ResolvedEnricherFlags {
  const env = resolveEnricherFlagsFromEnv();
  return {
    dadata: env.dadata || hasAnyFlag(map, ["enrich-dadata", "dadataEnrich"]),
    nominatim: env.nominatim || hasAnyFlag(map, ["enrich-nominatim", "nominatimEnrich"]),
    llm: env.llm || hasAnyFlag(map, ["enrich-llm", "llmEnrich"]),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const batchSize = Number(readStringFlag(map, ["batch", "batch-size"]) ?? "100");
  const watch = hasAnyFlag(map, ["watch"]);
  const watchIdleMs = Number(readStringFlag(map, ["watch-idle-ms"]) ?? "5000");

  const flags = resolveConsumerFlags(map);
  const order =
    parsePipelineOrder(readStringFlag(map, ["pipeline-order"])) ??
    resolvePipelineOrderFromEnv() ??
    DEFAULT_PIPELINE_ORDER;

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    explicitEnricherFlags: flags,
    pipelineOrder: order,
    llmRuntimeOverride: flags.llm ? { enabled: true } : undefined,
  });

  if (!runtime.dataSource || !runtime.parseRawMessageHandler) {
    console.error("worker:enrich:run: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const repos = await createWorkerDbRepositories(runtime.dataSource);
  console.log(
    `enrich:run flags=${JSON.stringify(flags)} order=[${order.join(",")}] batch=${batchSize} watch=${watch}`,
  );

  const initial = await repos.enrichmentQueue.countByStatus();
  console.log(`Очередь: ${JSON.stringify(initial)}`);

  let ok = 0;
  let failed = 0;
  const progress = createProgress("enrich", watch ? 0 : initial.pending);

  for (;;) {
    const tasks = await repos.enrichmentQueue.claimBatch(batchSize);
    if (tasks.length === 0) {
      if (!watch) break;
      await sleep(watchIdleMs);
      continue;
    }

    for (const task of tasks) {
      try {
        const raw = await repos.rawMessages.findById(task.rawMessageId);
        if (!raw?.id) {
          await repos.enrichmentQueue.markFailed(task.id, "raw_message not found");
          failed += 1;
        } else {
          await runtime.parseRawMessageHandler.handle(raw);
          await repos.enrichmentQueue.markDone(task.id);
          ok += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await repos.enrichmentQueue.markFailed(task.id, message);
        failed += 1;
      }
      progress.tick(1, { ok, failed });
    }
  }

  progress.stop();
  const finalCounts = await repos.enrichmentQueue.countByStatus();
  console.log(`\nenrich:run done: ok=${ok}, failed=${failed}; очередь=${JSON.stringify(finalCounts)}`);
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
