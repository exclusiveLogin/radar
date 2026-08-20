import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  createWorkerCompositionRoot,
} from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { resolveInputPath } from "./cliPaths.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import {
  parseLongFlagsMap,
  parsePositionalArgs,
  parseStorageModeFromMap,
} from "./workerCliArgs.js";
import { parseIngestPhaseCli } from "./parseIngestPhaseCli.js";
import { buildParseInspectTrace, type ParseInspectGeoHit } from "../domain/parse/buildParseInspectTrace.js";
import { groomMessage } from "../domain/parse/groomMessage.js";

type ParsedCli = {
  filePathArg: string;
  textArg: string;
  outDir: string;
  storageMode: WorkerStorageMode;
  fullJson: boolean;
  ingestParsePhaseSelection: ReturnType<typeof parseIngestPhaseCli>;
};

function flagString(map: ReturnType<typeof parseLongFlagsMap>, key: string): string {
  const value = map.get(key);
  return typeof value === "string" ? value : "";
}

function parseInspectCli(argv: string[]): ParsedCli {
  const map = parseLongFlagsMap(argv);
  const positionalArgs = parsePositionalArgs(argv);
  return {
    filePathArg: positionalArgs[0] ?? "",
    textArg: flagString(map, "text"),
    outDir: flagString(map, "out"),
    storageMode: parseStorageModeFromMap(map, WorkerStorageMode.Db),
    fullJson: map.has("full-json"),
    ingestParsePhaseSelection: parseIngestPhaseCli(map),
  };
}

function resolveInputText(cli: ParsedCli): string {
  if (cli.textArg) return cli.textArg;
  if (!cli.filePathArg) {
    console.error(
      "Usage: npm run parse:inspect -- [--text=\"...\"] [--out=dir] [--storage-mode=db] [file.txt]",
    );
    process.exit(1);
  }
  const filePath = resolveInputPath(cli.filePathArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeOut(outDir: string, name: string, content: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), content, "utf8");
}

/** Agent debug: raw → groom/blocks/candidates/locations в --out dir. */
export async function runParseInspect(argv: string[]): Promise<void> {
  const cli = parseInspectCli(argv);
  const source = resolveInputText(cli);
  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("parse", ["parse"], {
    storageMode: cli.storageMode,
    ingestParsePhaseSelection: cli.ingestParsePhaseSelection,
  }));
  if (!runtime.parsePipelineService || !runtime.placeScan) {
    throw new Error("parse stack не инициализирован (нужен cap parse).");
  }
  const parsePipeline = runtime.parsePipelineService;
  const placeScan = runtime.placeScan;

  const blocks = splitMessageBlocks(source);
  const results = [];
  for (const [index, block] of blocks.entries()) {
    const executed = await parsePipeline.execute({
      rawText: block,
      index,
      file: cli.filePathArg || "stdin",
    });
    results.push(executed);
  }

  const primary = results[0];
  if (!primary) return;

  const groomed = groomMessage(source);
  const geoHits: ParseInspectGeoHit[] = [];
  const eventKind = primary.report.classification.kind;
  if (eventKind === "event" && primary.workspace) {
    const text = primary.workspace.groomedText;
    for (const hit of placeScan.matchRegions(text)) {
      geoHits.push({
        kind: "region",
        name: hit.entry.name,
        regionIso: hit.entry.regionIso,
        placeId: hit.entry.placeId,
        span: hit.span,
      });
    }
    for (const hit of placeScan.matchPlaces(text, {})) {
      geoHits.push({
        kind: "place",
        name: hit.entry.name,
        regionIso: hit.entry.regionIso,
        placeId: hit.entry.placeId,
        span: hit.span,
        centroidLat: hit.entry.centroidLat,
        centroidLon: hit.entry.centroidLon,
      });
    }
  }

  const { trace, summaryMd } = buildParseInspectTrace({
    rawText: source,
    workspace: eventKind === "event" ? primary.workspace : undefined,
    kind: eventKind,
    reason: eventKind !== "event" ? primary.report.classification.reason : undefined,
    locations: primary.locations,
    geoHits,
  });

  if (cli.outDir) {
    writeOut(cli.outDir, "00-input.txt", source);
    writeOut(
      cli.outDir,
      "01-groom.json",
      JSON.stringify(
        groomed.kind === "event"
          ? { groomedText: groomed.groomedText, blocks: groomed.blocks }
          : groomed,
        null,
        2,
      ),
    );
    writeOut(cli.outDir, "03-geo-hits.json", JSON.stringify(geoHits, null, 2));
    if (eventKind === "event" && primary.workspace) {
      writeOut(
        cli.outDir,
        "04-candidates.json",
        JSON.stringify(primary.workspace.candidates, null, 2),
      );
      writeOut(
        cli.outDir,
        "05-traits.json",
        JSON.stringify(primary.workspace.traitAttachments, null, 2),
      );
      writeOut(cli.outDir, "07-locations.json", JSON.stringify(primary.locations, null, 2));
    }
    writeOut(cli.outDir, "08-summary.md", summaryMd);
    if (cli.fullJson) {
      writeOut(cli.outDir, "full.json", JSON.stringify({ trace, results }, null, 2));
    }
    console.log(JSON.stringify({ outDir: cli.outDir, trace }, null, 2));
    return;
  }

  console.log(JSON.stringify({ trace, summaryMd, geoHits, results }, null, 2));
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  await runParseInspect(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
