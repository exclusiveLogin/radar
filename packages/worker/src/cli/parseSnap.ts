import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  createWorkerCompositionRoot,
  type WorkerCompositionOptions,
} from "../application/createWorkerCompositionRoot.js";
import type { PipelineStepId } from "../infrastructure/enrichers/enricherChainFactory.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { GeoValidationService } from "../application/parsing/geoValidationService.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceEvidenceRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../application/handlers/inMemoryRepositories.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import {
  hasAnyFlag,
  parseLongFlagsMap,
  parsePipelineOrder,
  parsePositionalArgs,
  parseStorageModeFromMap,
} from "./workerCliArgs.js";

type ParseSummary = {
  totalBlocks: number;
  events: number;
  noise: number;
  meta: number;
  eventShare: number;
  geoValidation?: {
    known: number;
    created: number;
    rejected: number;
  };
  geoEnrichers?: {
    dadata: boolean;
    nominatim: boolean;
    llm: boolean;
  };
};

type ParsedCli = {
  filePathArg: string;
  withGeoReport: boolean;
  storageMode: WorkerStorageMode;
  enrichDadata: boolean;
  enrichNominatim: boolean;
  enrichLlm: boolean;
  pipelineOrder: PipelineStepId[] | undefined;
};

function parseParseSnapCli(argv: string[]): ParsedCli {
  const map = parseLongFlagsMap(argv);
  const positionalArgs = parsePositionalArgs(argv);
  const filePathArg = positionalArgs[0] ?? "";

  return {
    filePathArg,
    withGeoReport: map.has("geo-report"),
    storageMode: parseStorageModeFromMap(map, WorkerStorageMode.Memory),
    enrichDadata: hasAnyFlag(map, ["dadataEnrich", "enrich-dadata"]),
    enrichNominatim: hasAnyFlag(map, ["nominatimEnrich", "enrich-nominatim"]),
    enrichLlm: hasAnyFlag(map, ["llmEnrich", "enrich-llm"]),
    pipelineOrder: parsePipelineOrder(
      typeof map.get("pipeline-order") === "string"
        ? String(map.get("pipeline-order"))
        : undefined,
    ),
  };
}

function resolveInputPath(arg: string): string {
  if (path.isAbsolute(arg)) return arg;
  const local = path.resolve(process.cwd(), arg);
  if (fs.existsSync(local)) return local;
  return path.resolve(process.cwd(), "../../", arg);
}

function buildSummary(kinds: Array<"event" | "noise" | "meta">): ParseSummary {
  const totalBlocks = kinds.length;
  const events = kinds.filter((kind) => kind === "event").length;
  const noise = kinds.filter((kind) => kind === "noise").length;
  const meta = kinds.filter((kind) => kind === "meta").length;
  return {
    totalBlocks,
    events,
    noise,
    meta,
    eventShare: totalBlocks > 0 ? Number((events / totalBlocks).toFixed(4)) : 0,
  };
}

function buildRuntimeOptions(cli: ParsedCli): WorkerCompositionOptions {
  if (!cli.withGeoReport) {
    return { storageMode: cli.storageMode, explicitEnricherFlags: false };
  }

  return {
    storageMode: cli.storageMode,
    explicitEnricherFlags: {
      dadata: cli.enrichDadata,
      nominatim: cli.enrichNominatim,
      llm: cli.enrichLlm,
    },
    pipelineOrder: cli.pipelineOrder,
    llmRuntimeOverride: cli.enrichLlm ? { enabled: true } : undefined,
  };
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const cli = parseParseSnapCli(process.argv);
  if (!cli.filePathArg) {
    console.error(
      "Usage: npm run parse:snap -- <path-to-snap.txt> [--geo-report] [--storage-mode=memory|db|fs] [--enrich-dadata] [--enrich-nominatim] [--enrich-llm] [--pipeline-order=catalog,llm,dadata,nominatim]",
    );
    process.exit(1);
  }

  const wantsEnrichers = cli.enrichDadata || cli.enrichNominatim || cli.enrichLlm;
  if (wantsEnrichers && !cli.withGeoReport) {
    console.warn(
      "parse:snap: флаги enrichers действуют только вместе с --geo-report, игнорируются.",
    );
  }

  const filePath = resolveInputPath(cli.filePathArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const runtime = createWorkerCompositionRoot(buildRuntimeOptions(cli));
  const source = fs.readFileSync(filePath, "utf8");
  const blocks = splitMessageBlocks(source);
  const classifier = new RuleBasedEventClassifier();
  const results = blocks.map((block, index) => ({
    index,
    block,
    result: classifier.classify(block),
  }));
  const summary = buildSummary(results.map((row) => row.result.kind));

  if (cli.withGeoReport) {
    summary.geoEnrichers = {
      dadata: cli.enrichDadata,
      nominatim: cli.enrichNominatim,
      llm: cli.enrichLlm,
    };
    const validation = new GeoValidationService(
      new InMemoryRegionRepository(),
      new InMemoryPlaceRepository(),
      new InMemoryPlaceAliasRepository(),
      new InMemoryPlaceEvidenceRepository(),
    );
    let known = 0;
    let created = 0;
    let rejected = 0;

    for (const row of results) {
      if (row.result.kind !== "event") continue;
      const resolved = await runtime.locationResolutionService.resolve(row.block);
      if (resolved.locations.length === 0) {
        rejected += 1;
        continue;
      }

      let hasAccepted = false;
      for (const location of resolved.locations) {
        const decision = await validation.validate(row.block, location);
        if (decision.decision === "matched_existing") {
          known += 1;
          hasAccepted = true;
        } else if (decision.decision === "created_new") {
          created += 1;
          hasAccepted = true;
        }
      }
      if (!hasAccepted) {
        rejected += 1;
      }
    }
    summary.geoValidation = { known, created, rejected };
  }

  console.log(
    JSON.stringify(
      {
        filePath,
        storageMode: cli.storageMode,
        summary,
        results: results.map((row) => ({
          index: row.index,
          kind: row.result.kind,
          reason: "reason" in row.result ? row.result.reason : undefined,
          event: "event" in row.result ? row.result.event : undefined,
        })),
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
