import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "./createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import {
  resolveWorkerRoleFromEnv,
  roleRunsBackfill,
  roleRunsLiveIngest,
  roleRunsPhaseDaemons,
  roleRunsTrackingDaemon,
} from "../infrastructure/config/workerRole.js";
import { isDadataConfigured } from "../infrastructure/enrichers/dadataConfig.js";
import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { workerRuntimeStatus } from "./workerRuntimeStatus.js";
import { startWorkerProbeServer } from "../infrastructure/probe/workerProbeServer.js";

/**
 * Точка входа worker: env → composition root → daemons по RADAR_WORKER_ROLE.
 * Проверка парсера — отдельно: `npm run parse:snap`, `npm run parse:report` (не в bootstrap).
 */
export async function runWorkerBootstrap(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const workerRole = resolveWorkerRoleFromEnv();

  if (!isDadataConfigured()) {
    console.warn(
      "DaData: DADATA_TOKEN не задан — шаг dadata no-op (координаты только catalog/llm/nominatim).",
    );
  }
  await runLlmStartupCheck();
  const runtime = await createWorkerCompositionRoot({ workerRole });

  workerRuntimeStatus.init(runtime.storageMode, workerRole);
  const probe = startWorkerProbeServer();

  console.log(`Режим хранилища worker: ${runtime.storageMode}.`);
  console.log(`Роль worker: ${workerRole}.`);
  console.log("Write-side handlers и event bus инициализированы.");

  if (runtime.storageMode === WorkerStorageMode.Db) {
    if (roleRunsLiveIngest(workerRole)) {
      if (!runtime.ingestOrchestrator) {
        throw new Error("Ingest orchestrator не инициализирован для роли ingest/all.");
      }
      console.log("Запуск IngestOrchestrator (active providers из БД)...");
      await runtime.ingestOrchestrator.start();
    }

    if (roleRunsBackfill(workerRole) && runtime.backfillDaemon) {
      runtime.backfillDaemon.start();
      console.log("BackfillDaemon запущен (ingest_backfill_jobs).");
    }

    if (roleRunsPhaseDaemons(workerRole) && runtime.ingestParseDaemon) {
      console.log("IngestParseDaemon запущен (scheduled ingestParse → phase_coverage).");
    }
    if (roleRunsPhaseDaemons(workerRole) && runtime.placeEnrichmentDaemon) {
      console.log(
        "GeoParseDaemon запущен (scheduled geoParse → place_enrichment_jobs; в консоль: [geo:nominatim] ok|miss|fail, подробно: RADAR_VERBOSE_GEO_LOG=1).",
      );
    }

    if (roleRunsTrackingDaemon(workerRole) && runtime.trackingRebuildDaemon) {
      runtime.trackingRebuildDaemon.start();
      console.log("TrackingRebuildDaemon запущен (trajectory_tracks).");
    }
    if (roleRunsTrackingDaemon(workerRole) && runtime.trackingTuneDaemon) {
      runtime.trackingTuneDaemon.start();
      console.log("TrackingTuneDaemon запущен (tracking_tune_runs).");
    }

    workerRuntimeStatus.setRunning();

    const shutdown = async () => {
      console.log("Остановка worker...");
      workerRuntimeStatus.setStopped();
      probe.server?.close();
      await runtime.shutdown?.();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    return;
  }

  workerRuntimeStatus.setRunning();

  console.log(
    "Memory mode: долгоживущий ingest не запускается. Для parse — parse:snap / parse:report; для продукта — RADAR_STORAGE_MODE=db.",
  );
}

async function runLlmStartupCheck(): Promise<void> {
  const config = loadLlmRuntimeConfig();
  if (!config.enabled) {
    console.log("LLM enricher: disabled.");
    return;
  }

  const healthUrl = new URL("/api/tags", config.baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 5000));

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
    });
    if (response.ok) {
      console.log(`LLM enricher: ${config.provider} ready (${config.model}).`);
      return;
    }
    console.warn(
      `LLM enricher: health check failed (${response.status}), pipeline will fallback.`,
    );
  } catch {
    console.warn("LLM enricher: endpoint unavailable, pipeline will fallback.");
  } finally {
    clearTimeout(timer);
  }
}
