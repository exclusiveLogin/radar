import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { parseLongFlagsMap, parseStorageModeFromMap } from "./workerCliArgs.js";

type CliOptions = {
  input: string;
  storageMode: WorkerStorageMode;
  model?: string;
  baseUrl?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const map = parseLongFlagsMap(argv);

  const input = map.get("input");
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error(
      "Usage: npm run parse:snap:ollama -- --input tests/snap_001.txt [--storage-mode=memory|db|fs] [--model qwen2.5:3b] [--base-url http://127.0.0.1:11434/v1]",
    );
  }

  return {
    input,
    storageMode: parseStorageModeFromMap(map, WorkerStorageMode.Memory),
    model: typeof map.get("model") === "string" ? String(map.get("model")) : undefined,
    baseUrl:
      typeof map.get("base-url") === "string"
        ? String(map.get("base-url"))
        : undefined,
  };
}

function resolveInputPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  const fromCwd = path.resolve(process.cwd(), input);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(MONOREPO_ROOT, input);
}

async function probeOllama(
  baseUrl: string,
  model: string,
): Promise<{ ok: boolean; status?: number; models: string[] }> {
  const url = new URL("/api/tags", baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status, models: [] };
    }
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[];
    const hasModel =
      models.includes(model) ||
      models.some((name) => name.startsWith(`${model}:`) || name === model);
    return { ok: hasModel, status: response.status, models };
  } catch {
    return { ok: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

function applyLlmEnv(options: CliOptions): { baseUrl: string; model: string } {
  process.env.RADAR_LLM_GEOCODER_ENABLED = "1";
  process.env.RADAR_LLM_PROVIDER = process.env.RADAR_LLM_PROVIDER || "ollama";
  if (options.baseUrl) process.env.RADAR_LLM_BASE_URL = options.baseUrl;
  if (options.model) process.env.RADAR_LLM_MODEL = options.model;

  return {
    baseUrl: process.env.RADAR_LLM_BASE_URL || "http://127.0.0.1:11434/v1",
    model: process.env.RADAR_LLM_MODEL || "qwen2.5:3b",
  };
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const options = parseArgs(process.argv);
  const filePath = resolveInputPath(options.input);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const { baseUrl, model } = applyLlmEnv(options);
  const probe = await probeOllama(baseUrl, model);
  if (!probe.ok) {
    const modelsHint =
      probe.models.length > 0
        ? `Доступные модели: ${probe.models.join(", ")}`
        : "Список моделей пуст.";
    throw new Error(
      `Ollama: модель "${model}" не найдена на ${baseUrl} (status=${probe.status ?? "n/a"}). ${modelsHint}\n` +
        "Частая причина на Windows: локальный ollama.exe на 127.0.0.1:11434 (пустой), а Docker с моделями на другом порту.\n" +
        "Fix: 1) закрой Ollama Desktop, или 2) OLLAMA_PORT=11435 в .env + RADAR_LLM_BASE_URL=http://127.0.0.1:11435/v1 + docker compose --profile llm up -d ollama, или 3) ollama pull в локальный Ollama.",
    );
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: options.storageMode,
    llmRuntimeOverride: { enabled: true },
    explicitEnricherFlags: { dadata: false, nominatim: false, llm: true },
  });
  const source = fs.readFileSync(filePath, "utf8");
  const blocks = splitMessageBlocks(source);
  const results = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const rawText = blocks[index];
    const parsed = await runtime.parsePipelineService.execute({
      rawText,
      index,
      file: path.basename(filePath),
      postedAt: new Date().toISOString(),
      channelKey: "snap-ollama",
    });

    results.push({
      index,
      kind: parsed.report.classification.kind,
      geoSource: parsed.report.geo.source,
      enrich: parsed.report.enrich,
      regions: parsed.report.geo.regions,
      places: parsed.report.geo.places,
    });
  }

  console.log(
    JSON.stringify(
      {
        filePath,
        baseUrl,
        model,
        totalBlocks: blocks.length,
        storageMode: options.storageMode,
        llmEnabled: process.env.RADAR_LLM_GEOCODER_ENABLED === "1",
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
