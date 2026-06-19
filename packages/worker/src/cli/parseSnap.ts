import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  createWorkerCompositionRoot,
  type WorkerCompositionOptions,
} from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { GeoValidationService } from "../application/parsing/geoValidationService.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../application/handlers/inMemoryRepositories.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { resolveInputPath } from "./cliPaths.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";
import {
  parseLongFlagsMap,
  parsePositionalArgs,
  parseStorageModeFromMap,
} from "./workerCliArgs.js";
import {
  applyForceLlmPhaseSelection,
  parseIngestPhaseCli,
} from "./parseIngestPhaseCli.js";
import type { IngestParsePhaseSelection } from "../application/parse/loadIngestParsePhases.js";

type ParseSummary = {
  totalBlocks: number;
  events: number;
  noise: number;
  meta: number;
  eventShare: number;
  ingestParsePhases: string[];
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
  ingestParsePhaseSelection: IngestParsePhaseSelection;
};

function parseParseSnapCli(argv: string[]): ParsedCli {
  const map = parseLongFlagsMap(argv);
  const positionalArgs = parsePositionalArgs(argv);
  const filePathArg = positionalArgs[0] ?? "";

  return {
    filePathArg,
    withGeoReport: map.has("geo-report"),
    storageMode: parseStorageModeFromMap(map, WorkerStorageMode.Memory),
    ingestParsePhaseSelection: parseIngestPhaseCli(map),
  };
}

function buildSummary(kinds: Array<"event" | "noise" | "meta">): Omit<ParseSummary, "ingestParsePhases"> {
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
  return {
    storageMode: cli.storageMode,
    startIngestParseDaemon: false,
    ingestParsePhaseSelection: cli.ingestParsePhaseSelection,
  };
}

/** Опции переопределения контракта для прокси-обёрток (например, `:ollama`). */
export type RunParseSnapOptions = {
  /** Принудительно включает LLM-обогащение + гео-отчёт (для `parse:snap:ollama`). */
  forceLlm?: boolean;
};

/**
 * Ядро `parse:snap`: разбор аргументов, классификация и опциональный гео-отчёт.
 * Не загружает .env — это ответственность вызывающего `main`/прокси.
 */
export async function runParseSnap(
  argv: string[],
  options: RunParseSnapOptions = {},
): Promise<void> {
  const cli = parseParseSnapCli(argv);
  if (options.forceLlm) {
    cli.withGeoReport = true;
    cli.ingestParsePhaseSelection = applyForceLlmPhaseSelection(
      cli.ingestParsePhaseSelection,
    );
  }
  if (!cli.filePathArg) {
    console.error(
      "Usage: npm run parse:snap -- <path-to-snap.txt> [--geo-report] [--storage-mode=memory|db|fs] [--phases=llm,dadata]",
    );
    process.exit(1);
  }

  const filePath = resolveInputPath(cli.filePathArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const runtime = await createWorkerCompositionRoot(buildRuntimeOptions(cli));
  const source = fs.readFileSync(filePath, "utf8");
  const blocks = splitMessageBlocks(source);
  const results = [];
  for (const [index, block] of blocks.entries()) {
    const executed = await runtime.parsePipelineService.execute({
      rawText: block,
      index,
      file: path.basename(filePath),
    });
    results.push({
      index,
      block,
      kind: executed.report.classification.kind,
      report: executed.report,
      workspace: executed.workspace,
      passes: executed.passes,
      locations: executed.locations,
    });
  }
  const summary: ParseSummary = {
    ...buildSummary(results.map((row) => row.kind)),
    ingestParsePhases: runtime.ingestParsePhases.map((phase) => phase.id),
  };

  if (cli.withGeoReport) {
    summary.geoEnrichers = {
      dadata: runtime.ingestParsePhases.some((p) => p.enrichers.includes("dadata")),
      nominatim: runtime.ingestParsePhases.some((p) => p.enrichers.includes("nominatim")),
      llm: runtime.ingestParsePhases.some((p) => p.enrichers.includes("llm")),
    };
    const validation = new GeoValidationService(
      new InMemoryRegionRepository(),
      new InMemoryPlaceRepository(),
      new InMemoryPlaceAliasRepository(),
    );
    let known = 0;
    let created = 0;
    let rejected = 0;

    for (const row of results) {
      if (row.kind !== "event") continue;
      const resolved = { locations: row.locations };
      if (resolved.locations.length === 0) {
        rejected += 1;
        continue;
      }

      let hasAccepted = false;
      const placeLikeCount = resolved.locations.filter(
        (loc) =>
          loc.placeName
          && loc.entityKind !== "region"
          && loc.precision !== "region",
      ).length;
      const multiPlaceContext = placeLikeCount > 1;

      for (const location of resolved.locations) {
        const decision = await validation.validate(row.block, location, {
          multiPlaceContext,
        });
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
          kind: row.kind,
          reason:
            row.report.classification.kind !== "event"
              ? row.report.classification.reason
              : undefined,
          event: row.report.event,
          candidates: row.report.candidates,
          workspace: row.workspace,
          passes: row.passes.map((pass) => ({
            phaseId: pass.phaseId,
            runKind: pass.runKind,
            enrichers: pass.enrichers,
            outcome: pass.result.kind,
            reason: pass.result.kind !== "event" ? pass.result.reason : undefined,
          })),
        })),
      },
        null,
        2,
      ),
    );
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  await runParseSnap(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
