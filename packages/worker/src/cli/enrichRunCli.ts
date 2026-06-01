/**
 * ---
 * layer: worker/cli
 * kind: enrichment-consumer
 * purpose: Per-provider фоновое обогащение (ADR-003): догоняет один stage и мержит вклад.
 * ---
 *
 * Берёт пачку задач выбранного stage (llm|dadata|nominatim) из enrichment_queue,
 * прогоняет фазу этого прохода (catalog + stage) через тот же
 * ParseRawMessageHandler (единое ядро исполнения с eager-путём), мержит вклад в
 * накопитель и пересчитывает статус (re-эмит MessageParsed → проекция/WS).
 * Enqueue идемпотентен по (raw_message_id, stage) — петли ре-энкью нет.
 *
 * Usage:
 *   npm run worker:enrich:run -- --stage=llm --batch=100 [--watch]
 *   npm run worker:enrich:run -- --stage=dadata
 */
import { MONOREPO_ROOT } from "@repo/root";
import type { EnrichStage } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import {
  type PipelineStepId,
  type ResolvedEnricherFlags,
} from "../infrastructure/enrichers/enricherChainFactory.js";
import { createProgress } from "./progress.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

const VALID_STAGES: readonly EnrichStage[] = ["llm", "dadata", "nominatim"];

/** Флаги энричеров для одного прохода: включён только сам stage. */
function stageFlags(stage: EnrichStage): ResolvedEnricherFlags {
  return {
    dadata: stage === "dadata",
    nominatim: stage === "nominatim",
    llm: stage === "llm",
  };
}

/** Порядок шагов фазы прохода: catalog задаёт regionCode-контекст, затем stage. */
function stageOrder(stage: EnrichStage): PipelineStepId[] {
  return ["catalog", stage];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function parseStage(value: string | undefined): EnrichStage {
  const stage = value?.trim().toLowerCase() as EnrichStage | undefined;
  if (!stage || !VALID_STAGES.includes(stage)) {
    console.error(`worker:enrich:run: нужен --stage=<${VALID_STAGES.join("|")}>`);
    process.exit(1);
  }
  return stage;
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const stage = parseStage(readStringFlag(map, ["stage"]));
  const batchSize = Number(readStringFlag(map, ["batch", "batch-size"]) ?? "100");
  const watch = hasAnyFlag(map, ["watch"]);
  const watchIdleMs = Number(readStringFlag(map, ["watch-idle-ms"]) ?? "5000");

  const flags = stageFlags(stage);
  const order = stageOrder(stage);

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
  console.log(`enrich:run stage=${stage} order=[${order.join(",")}] batch=${batchSize} watch=${watch}`);

  const initial = await repos.enrichmentQueue.countByStatus(stage);
  console.log(`Очередь[${stage}]: ${JSON.stringify(initial)}`);

  let ok = 0;
  let failed = 0;
  const progress = createProgress(`enrich:${stage}`, watch ? 0 : initial.pending);

  for (;;) {
    const tasks = await repos.enrichmentQueue.claimBatch(stage, batchSize);
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
  const finalCounts = await repos.enrichmentQueue.countByStatus(stage);
  console.log(`\nenrich:run[${stage}] done: ok=${ok}, failed=${failed}; очередь=${JSON.stringify(finalCounts)}`);
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
