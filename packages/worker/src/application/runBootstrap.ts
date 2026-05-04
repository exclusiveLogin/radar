import { MONOREPO_ROOT } from "@repo/root";
import { loadParseRuntimeConfig } from "./parseRuntimeConfig.js";
import { planChannelIngests } from "./parsing/channelIngestPlanner.js";
import { loadChannelManifest } from "../infrastructure/manifest/channelManifestLoader.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createTtyPrompter } from "../infrastructure/io/ttyPrompter.js";
import { runTelegramUserSessionBootstrap } from "../infrastructure/telegram/userSessionLifecycle.js";

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

  const prompter = createTtyPrompter();
  await runTelegramUserSessionBootstrap({
    repoRoot: MONOREPO_ROOT,
    credentials: { apiId: creds.apiId, apiHash: creds.apiHash },
    prompter,
  });
}
