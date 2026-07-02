#!/usr/bin/env node
/**
 * Smoke: ParseWorkerPool поднимает worker_threads и выполняет parse.
 * Запуск из packages/worker: npx tsx scripts/verify-parse-threads.mjs
 */
import { ParseWorkerPool } from "../src/application/parse/parseWorkerPool.ts";
import {
  DEFAULT_PIPELINE_ORDER,
  resolveEnricherFlagsFromEnv,
} from "../src/infrastructure/enrichers/enricherChainFactory.ts";
import { loadLlmRuntimeConfig } from "../src/infrastructure/enrichers/llmRuntimeConfig.ts";

const sampleText =
  "🚨 Тревога! БПЛА в сторону Белгорода. Отбой через 15 минут.";

const pool = new ParseWorkerPool(
  {
    enricherFlags: resolveEnricherFlagsFromEnv(),
    pipelineOrder: DEFAULT_PIPELINE_ORDER,
    llmRuntimeConfig: loadLlmRuntimeConfig(),
  },
  2,
);

console.log("[1/3] ParseWorkerPool: 2 worker_threads spawned");

const result = await pool.execute({
  rawText: sampleText,
  channelKey: "radar-pf",
  postedAt: new Date().toISOString(),
});

const report = result.report;
console.log("[2/3] parse in thread OK:", {
  eventType: report.eventType,
  contentKind: report.contentKind,
  locations: result.locations?.length ?? 0,
});

await pool.shutdown();
console.log("[3/3] pool shutdown OK");
