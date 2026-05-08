import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";

type CliOptions = {
  input: string;
  model?: string;
  baseUrl?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const map = new Map<string, string | true>();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      map.set(key, next);
      i += 1;
    } else {
      map.set(key, true);
    }
  }

  const input = map.get("input");
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error(
      "Usage: npm run parse:snap:ollama -- --input tests/snap_001.txt [--model qwen2.5:3b] [--base-url http://127.0.0.1:11434/v1]",
    );
  }

  return {
    input,
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

async function probeOllama(baseUrl: string): Promise<{ ok: boolean; status?: number }> {
  const url = new URL("/api/tags", baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const options = parseArgs(process.argv);
  const filePath = resolveInputPath(options.input);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  process.env.RADAR_LLM_GEOCODER_ENABLED = "1";
  process.env.RADAR_LLM_PROVIDER = process.env.RADAR_LLM_PROVIDER || "ollama";
  if (options.baseUrl) process.env.RADAR_LLM_BASE_URL = options.baseUrl;
  if (options.model) process.env.RADAR_LLM_MODEL = options.model;

  const baseUrl = process.env.RADAR_LLM_BASE_URL || "http://127.0.0.1:11434/v1";
  const model = process.env.RADAR_LLM_MODEL || "qwen2.5:3b";
  const probe = await probeOllama(baseUrl);
  if (!probe.ok) {
    throw new Error(
      `Ollama probe failed for ${baseUrl} (status=${probe.status ?? "n/a"}). Start Docker profile llm first.`,
    );
  }

  const runtime = createWorkerCompositionRoot({ enableProviders: true });
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
