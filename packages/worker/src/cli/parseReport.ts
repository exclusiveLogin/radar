import * as fs from "node:fs";
import * as path from "node:path";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import {
  JsonPlaceCacheRepository,
  resolveJsonPlaceCachePath,
} from "../infrastructure/persistence/index.js";

type CliOptions = {
  input: string;
  outdir: string;
  format: "json" | "yaml" | "csv";
  div: "file" | "record";
  useProviders: boolean;
};

type FlatRecord = {
  file: string;
  index: number;
  kind: string;
  eventType: string;
  regionCode: string;
  placeName: string;
  precision: string;
  completeness: number;
  source: string;
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

  const formatRaw = String(map.get("format") ?? "json").toLowerCase();
  const divRaw = String(map.get("div") ?? "file").toLowerCase();

  const format = ["json", "yaml", "csv"].includes(formatRaw)
    ? (formatRaw as CliOptions["format"])
    : "json";
  const div = ["file", "record"].includes(divRaw)
    ? (divRaw as CliOptions["div"])
    : "file";

  return {
    input: String(map.get("input") ?? "tests"),
    outdir: String(map.get("outdir") ?? "reports"),
    format,
    div,
    useProviders: map.has("use-providers"),
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

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function serializeYaml(value: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);

  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const nested = serializeYaml(item, depth + 1);
          return `${indent}-\n${nested}`;
        }
        return `${indent}- ${serializeYaml(item, depth + 1)}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";

  return entries
    .map(([key, item]) => {
      if (typeof item === "object" && item !== null) {
        return `${indent}${key}:\n${serializeYaml(item, depth + 1)}`;
      }
      return `${indent}${key}: ${serializeYaml(item, depth + 1)}`;
    })
    .join("\n");
}

function toFlatRecords(fileName: string, payload: Array<Record<string, unknown>>): FlatRecord[] {
  return payload.map((row, index) => {
    const classification = (row.classification as Record<string, unknown>) ?? {};
    const event = (row.event as Record<string, unknown> | undefined) ?? {};
    const geo = (row.geo as Record<string, unknown>) ?? {};
    const places = (geo.places as Array<Record<string, unknown>> | undefined) ?? [];
    const firstPlace = places[0] ?? {};

    return {
      file: fileName,
      index,
      kind: String(classification.kind ?? "unknown"),
      eventType: String(event.eventType ?? ""),
      regionCode: String((geo.region as Record<string, unknown> | undefined)?.code ?? ""),
      placeName: String(firstPlace.name ?? ""),
      precision: String(geo.precision ?? "unknown"),
      completeness: Number(geo.completeness ?? 0),
      source: String(geo.source ?? "local"),
    };
  });
}

function writePayload(targetPath: string, format: CliOptions["format"], payload: unknown): void {
  if (format === "json") {
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
    return;
  }

  if (format === "yaml") {
    fs.writeFileSync(targetPath, `${serializeYaml(payload)}\n`, "utf8");
    return;
  }

  const rows = payload as FlatRecord[];
  const header = "file,index,kind,event_type,region_code,place_name,precision,completeness,source";
  const body = rows
    .map((row) =>
      [
        row.file,
        row.index,
        row.kind,
        row.eventType,
        row.regionCode,
        row.placeName,
        row.precision,
        row.completeness,
        row.source,
      ]
        .map((cell) => escapeCsv(String(cell)))
        .join(","),
    )
    .join("\n");

  fs.writeFileSync(targetPath, `${header}\n${body}\n`, "utf8");
}

async function main(): Promise<void> {
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
  const runtime = createWorkerCompositionRoot({
    placeCacheRepository: placeCache,
    enableProviders: options.useProviders,
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

