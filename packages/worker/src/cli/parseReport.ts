import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import type { PipelineStepId } from "../infrastructure/enrichers/enricherChainFactory.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import {
  JsonPlaceCacheRepository,
  WorkerStorageMode,
  resolveJsonPlaceCachePath,
} from "../infrastructure/persistence/index.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import {
  parseLongFlagsMap,
  parsePipelineOrder,
  parseStorageModeFromMap,
} from "./workerCliArgs.js";
import {
  type FlatRecord,
  toFlatRecords,
  writePayload,
} from "./reportOutput.js";

type CliOptions = {
  input: string;
  outdir: string;
  format: "json" | "yaml" | "csv";
  div: "file" | "record";
  storageMode: WorkerStorageMode;
  enrichDadata: boolean;
  enrichNominatim: boolean;
  enrichLlm: boolean;
  pipelineOrder: PipelineStepId[] | undefined;
};

function parseArgs(argv: string[]): CliOptions {
  const map = parseLongFlagsMap(argv);

  const formatRaw = String(map.get("format") ?? "json").toLowerCase();
  const divRaw = String(map.get("div") ?? "file").toLowerCase();

  const format = ["json", "yaml", "csv"].includes(formatRaw)
    ? (formatRaw as CliOptions["format"])
    : "json";
  const div = ["file", "record"].includes(divRaw)
    ? (divRaw as CliOptions["div"])
    : "file";

  const pipelineOrder = parsePipelineOrder(
    typeof map.get("pipeline-order") === "string"
      ? String(map.get("pipeline-order"))
      : undefined,
  );

  return {
    input: String(map.get("input") ?? "tests"),
    outdir: String(map.get("outdir") ?? "reports"),
    format,
    div,
    storageMode: parseStorageModeFromMap(map, WorkerStorageMode.Fs),
    enrichDadata: map.has("enrich-dadata") || map.has("use-providers"),
    enrichNominatim: map.has("enrich-nominatim") || map.has("use-providers"),
    enrichLlm: map.has("enrich-llm"),
    pipelineOrder,
  };
}

function resolvePath(input: string): string {
  if (path.isAbsolute(input)) return input;

  const candidates = [
    path.resolve(process.cwd(), input),
    path.resolve(process.cwd(), "../../", input),
    path.resolve(process.cwd(), "../../../", input),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function listInputFiles(inputPath: string): string[] {
  const stats = fs.statSync(inputPath);
  if (stats.isFile()) {
    return [inputPath];
  }

  return fs
    .readdirSync(inputPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => path.join(inputPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function ensureCleanOutdir(outdir: string): void {
  if (fs.existsSync(outdir)) {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
  fs.mkdirSync(outdir, { recursive: true });
}

function buildEnricherFlags(options: CliOptions):
  | { dadata: boolean; nominatim: boolean; llm: boolean }
  | false {
  const anyProvider =
    options.enrichDadata || options.enrichNominatim || options.enrichLlm;
  if (!anyProvider) {
    return false;
  }
  return {
    dadata: options.enrichDadata,
    nominatim: options.enrichNominatim,
    llm: options.enrichLlm,
  };
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const options = parseArgs(process.argv);
  const inputPath = resolvePath(options.input);
  const outdir = resolvePath(options.outdir);
  const files = listInputFiles(inputPath);

  if (files.length === 0) {
    throw new Error(`No .txt files found in ${inputPath}`);
  }

  if (options.format === "csv" && options.div !== "record") {
    throw new Error("CSV format supports only --div record");
  }

  ensureCleanOutdir(outdir);

  const explicitEnricherFlags = buildEnricherFlags(options);
  const placeCache = new JsonPlaceCacheRepository(resolveJsonPlaceCachePath());
  const runtime = createWorkerCompositionRoot({
    storageMode: options.storageMode,
    placeCacheRepository: placeCache,
    explicitEnricherFlags,
    pipelineOrder: options.pipelineOrder,
    llmRuntimeOverride: options.enrichLlm ? { enabled: true } : undefined,
  });

  const allRecords: FlatRecord[] = [];
  let totalBlocks = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const blocks = splitMessageBlocks(source);
    totalBlocks += blocks.length;

    const payload = [] as Array<Record<string, unknown>>;

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const result = await runtime.parsePipelineService.execute({
        rawText: block,
        postedAt: new Date().toISOString(),
        channelKey: path.basename(file, path.extname(file)),
        file: path.basename(file),
        index,
      });
      payload.push(result.report as unknown as Record<string, unknown>);
    }

    if (options.div === "file") {
      const ext = options.format === "yaml" ? "yaml" : options.format;
      const target = path.join(outdir, `${path.basename(file, path.extname(file))}.${ext}`);
      if (options.format === "csv") {
        writePayload(target, "csv", toFlatRecords(path.basename(file), payload));
      } else {
        writePayload(target, options.format, payload);
      }
    } else {
      const recordDir = path.join(outdir, path.basename(file, path.extname(file)));
      fs.mkdirSync(recordDir, { recursive: true });

      if (options.format === "csv") {
        const rows = toFlatRecords(path.basename(file), payload);
        allRecords.push(...rows);
      } else {
        for (let index = 0; index < payload.length; index += 1) {
          const ext = options.format === "yaml" ? "yaml" : options.format;
          const target = path.join(recordDir, `${String(index).padStart(3, "0")}.${ext}`);
          writePayload(target, options.format, payload[index]);
        }
      }
    }

    if (options.div === "file" && options.format === "csv") {
      allRecords.push(...toFlatRecords(path.basename(file), payload));
    }
  }

  if (options.format === "csv") {
    writePayload(path.join(outdir, "records.csv"), "csv", allRecords);
  }

  console.log(
    JSON.stringify(
      {
        inputPath,
        outdir,
        format: options.format,
        div: options.div,
        storageMode: options.storageMode,
        files: files.length,
        totalBlocks,
        csvRecords: allRecords.length,
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

