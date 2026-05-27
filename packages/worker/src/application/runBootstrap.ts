import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "./createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { ingestMessageHash } from "@radar/shared";

function readTelegramCredentials():
  | { ok: true; apiId: number; apiHash: string }
  | { ok: false } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() ?? "";
  if (!apiId || !apiHash) {
    return { ok: false };
  }
  return { ok: true, apiId, apiHash };
}

/**
 * Точка входа use-case: env → runtime (db orchestrator или memory demo).
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
    const creds = readTelegramCredentials();
    if (!creds.ok) {
      console.warn(
        "TELEGRAM_API_ID/HASH не заданы — telegram adapters могут не стартовать.",
      );
    }
    console.log("Запуск IngestOrchestrator (active providers из БД)...");
    await runtime.ingestOrchestrator.start();

    if (runtime.backfillDaemon) {
      runtime.backfillDaemon.start();
      console.log("BackfillDaemon запущен (ingest_backfill_jobs).");
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

  const creds = readTelegramCredentials();
  if (!creds.ok) {
    console.error(
      "Нужны TELEGRAM_API_ID и TELEGRAM_API_HASH (см. .env.example; значения с https://my.telegram.org).",
    );
    process.exit(1);
  }

  if (process.env.RADAR_BOOTSTRAP_DEMO_PARSE === "1") {
    const postedAt = new Date().toISOString();
    const demoRaw = {
      channelKey: "demo",
      providerKey: "demo",
      sourceKind: "manual" as const,
      externalMessageId: "demo-1",
      revisionKey: null,
      postedAt,
      ingestMode: "manual" as const,
      rawText: "Внимание по БПЛА в Белгородской области",
      hash: ingestMessageHash({
        channelKey: "demo",
        providerKey: "demo",
        sourceKind: "manual",
        externalMessageId: "demo-1",
        revisionKey: null,
        postedAt,
        rawText: "Внимание по БПЛА в Белгородской области",
      }),
    };
    const ingested = await runtime.ingestRawMessageHandler.handle(demoRaw);
    if (ingested.inserted) {
      const withId = { ...demoRaw, id: ingested.rawMessageId };
      await runtime.parseRawMessageHandler.handle(withId);
    }
  }
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
