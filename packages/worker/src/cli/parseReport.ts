import * as fs from "node:fs";
import * as path from "node:path";
import type { ParseReport } from "@radar/shared";
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import {
  JsonPlaceCacheRepository,
  WorkerStorageMode,
  resolveJsonPlaceCachePath,
} from "../infrastructure/persistence/index.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import {
  parseLongFlagsMap,
  parseStorageModeFromMap,
} from "./workerCliArgs.js";
import { parseIngestPhaseCli } from "./parseIngestPhaseCli.js";
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
  ingestParsePhaseSelection: ReturnType<typeof parseIngestPhaseCli>;
};

function parseEnum<T extends string>(raw: string, values: readonly T[], fallback: T): T {
  return values.includes(raw as T) ? (raw as T) : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  const map = parseLongFlagsMap(argv);

  const format = parseEnum(
    String(map.get("format") ?? "json").toLowerCase(),
    ["json", "yaml", "csv"] as const,
    "json",
  );
  const div = parseEnum(
    String(map.get("div") ?? "file").toLowerCase(),
    ["file", "record"] as const,
    "file",
  );

  return {
    input: String(map.get("input") ?? "tests"),
    outdir: String(map.get("outdir") ?? "reports"),
    format,
    div,
    storageMode: parseStorageModeFromMap(map, WorkerStorageMode.Fs),
    ingestParsePhaseSelection: parseIngestPhaseCli(map),
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

async function parseFileBlocks(options: {
  filePath: string;
  parse: NonNullable<
    Awaited<ReturnType<typeof createWorkerCompositionRoot>>["parsePipelineService"]
  >["execute"];
}): Promise<{
  payload: Array<Record<string, unknown>>;
  blocksCount: number;
  kinds: Array<"event" | "noise" | "meta">;
}> {
  const source = fs.readFileSync(options.filePath, "utf8");
  const blocks = splitMessageBlocks(source);
  const payload: Array<Record<string, unknown>> = [];
  const kinds: Array<"event" | "noise" | "meta"> = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const result = await options.parse({
      rawText: block,
      postedAt: new Date().toISOString(),
      channelKey: path.basename(options.filePath, path.extname(options.filePath)),
      file: path.basename(options.filePath),
      index,
    });
    const report = result.report as ParseReport;
    kinds.push(report.classification.kind);
    payload.push(report as unknown as Record<string, unknown>);
  }

  return { payload, blocksCount: blocks.length, kinds };
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

  const placeCache = new JsonPlaceCacheRepository(resolveJsonPlaceCachePath());
  const runtime = await createWorkerCompositionRoot({
    workerRole: "parse",
    bootCaps: ["parse"],
    storageMode: options.storageMode,
    placeCacheRepository: placeCache,
    startIngestParseDaemon: false,
    ingestParsePhaseSelection: options.ingestParsePhaseSelection,
  });
  if (!runtime.parsePipelineService) {
    throw new Error("parse stack не инициализирован (нужен cap parse).");
  }
  const parsePipeline = runtime.parsePipelineService;

  const allRecords: FlatRecord[] = [];
  let totalBlocks = 0;
  const allKinds: Array<"event" | "noise" | "meta"> = [];

  for (const file of files) {
    const { payload, blocksCount, kinds } = await parseFileBlocks({
      filePath: file,
      parse: parsePipeline.execute.bind(parsePipeline),
    });
    totalBlocks += blocksCount;
    allKinds.push(...kinds);

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

  const events = allKinds.filter((kind) => kind === "event").length;
  const noise = allKinds.filter((kind) => kind === "noise").length;
  const meta = allKinds.filter((kind) => kind === "meta").length;

  console.log(
    JSON.stringify(
      {
        inputPath,
        outdir,
        format: options.format,
        div: options.div,
        storageMode: options.storageMode,
        ingestParsePhases: runtime.ingestParsePhases.map((phase) => phase.id),
        files: files.length,
        totalBlocks,
        summary: {
          events,
          noise,
          meta,
          eventShare: totalBlocks > 0 ? Number((events / totalBlocks).toFixed(4)) : 0,
        },
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
