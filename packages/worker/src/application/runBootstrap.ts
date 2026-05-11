import { MONOREPO_ROOT } from "@repo/root";
import { loadParseRuntimeConfig } from "./parseRuntimeConfig.js";
import { planChannelIngests } from "./parsing/channelIngestPlanner.js";
import { createWorkerCompositionRoot } from "./createWorkerCompositionRoot.js";
import { loadChannelManifest } from "../infrastructure/manifest/channelManifestLoader.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createTtyPrompter } from "../infrastructure/io/ttyPrompter.js";
import { runTelegramUserSessionBootstrap } from "../infrastructure/telegram/userSessionLifecycle.js";
import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";

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
 * Точка входа use-case: env → манифест/конфиг (лог) → MTProto bootstrap.
 */
export async function runWorkerBootstrap(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  await runLlmStartupCheck();
  const runtime = createWorkerCompositionRoot();

  const creds = readTelegramCredentials();
  if (!creds.ok) {
    console.error(
      "Нужны TELEGRAM_API_ID и TELEGRAM_API_HASH (см. .env.example; значения с https://my.telegram.org).",
    );
    process.exit(1);
  }

  const parseConfig = loadParseRuntimeConfig(MONOREPO_ROOT);
  const manifest = loadChannelManifest(MONOREPO_ROOT);
  const planned = planChannelIngests({
    manifest,
    defaultParseConfig: parseConfig,
  });

  if (manifest) {
    console.log(
      `Манифест: ${manifest.channels.length} канал(ов), к парсингу: ${planned.length}.`,
    );
  } else {
    console.log(
      "Манифест каналов не найден (см. RADAR_CHANNEL_MANIFEST или `.radar/channels.manifest.json`).",
    );
  }
  console.log(
    `Конфиг парсинга: batchLimit=${parseConfig.batchLimit}, markAsRead=${parseConfig.markAsRead}.`,
  );
  console.log(`Режим хранилища worker: ${runtime.storageMode}.`);
  console.log("Write-side handlers и event bus инициализированы.");

  const prompter = createTtyPrompter();
  await runTelegramUserSessionBootstrap({
    repoRoot: MONOREPO_ROOT,
    credentials: { apiId: creds.apiId, apiHash: creds.apiHash },
    prompter,
  });

  if (process.env.RADAR_BOOTSTRAP_DEMO_PARSE === "1") {
    const demoRaw = {
      channelKey: "demo",
      telegramMessageId: 1,
      hash: "demo-hash",
      postedAt: new Date().toISOString(),
      rawText: "Внимание по БПЛА в Белгородской области",
    };
    const ingested = await runtime.ingestRawMessageHandler.handle(demoRaw);
    if (ingested.inserted) {
      await runtime.parseRawMessageHandler.handle(demoRaw);
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
