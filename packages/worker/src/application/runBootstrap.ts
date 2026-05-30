import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "./createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
/**
 * Точка входа worker: env → composition root → ingest orchestrator (db) или idle (memory).
 * Проверка парсера — отдельно: `npm run parse:snap`, `npm run parse:report` (не в bootstrap).
 */
export async function runWorkerBootstrap(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  await runLlmStartupCheck();
  const runtime = await createWorkerCompositionRoot();

  console.log(`Режим хранилища worker: ${runtime.storageMode}.`);
  console.log("Write-side handlers и event bus инициализированы.");

  if (runtime.storageMode === WorkerStorageMode.Db) {
    if (!runtime.ingestOrchestrator) {
      throw new Error("Ingest orchestrator не инициализирован в db mode.");
    }
    console.log("Запуск IngestOrchestrator (active providers из БД)...");
    await runtime.ingestOrchestrator.start();

    if (runtime.backfillDaemon) {
      runtime.backfillDaemon.start();
      console.log("BackfillDaemon запущен (ingest_backfill_jobs).");
    }

    if (runtime.mapStateExpiryDaemon) {
      runtime.mapStateExpiryDaemon.start();
      console.log("MapStateExpiryDaemon запущен (TTL статусов карты).");
    }

    const shutdown = async () => {
      console.log("Остановка worker...");
      await runtime.shutdown?.();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    return;
  }

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
