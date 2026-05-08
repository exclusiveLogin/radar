import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import type { PipelineStepId } from "../infrastructure/enrichers/enricherChainFactory.js";
import { GeoValidationService } from "../application/parsing/geoValidationService.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../application/handlers/inMemoryRepositories.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";

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
  enrichDadata: boolean;
  enrichNominatim: boolean;
  enrichLlm: boolean;
  pipelineOrder: PipelineStepId[] | undefined;
};

function parseParseSnapCli(argv: string[]): ParsedCli {
  const tokens = argv.slice(2);
  let filePathArg = "";
  let withGeoReport = false;
  let enrichDadata = false;
  let enrichNominatim = false;
  let enrichLlm = false;
  let pipelineOrder: PipelineStepId[] | undefined;

  const validStepIds = new Set<PipelineStepId>(["catalog", "llm", "dadata", "nominatim"]);

  for (const t of tokens) {
    if (t.startsWith("--")) {
      if (t.startsWith("--pipeline-order=")) {
        const raw = t.slice("--pipeline-order=".length);
        pipelineOrder = raw
          .split(",")
          .map((s) => s.trim().toLowerCase() as PipelineStepId)
          .filter((s) => validStepIds.has(s));
        continue;
      }
      switch (t) {
        case "--geo-report":
          withGeoReport = true;
          break;
        case "--dadataEnrich":
        case "--enrich-dadata":
          enrichDadata = true;
          break;
        case "--nominatimEnrich":
        case "--enrich-nominatim":
          enrichNominatim = true;
          break;
        case "--llmEnrich":
        case "--enrich-llm":
          enrichLlm = true;
          break;
        default:
          break;
      }
      continue;
    }
    filePathArg = t;
  }

  return { filePathArg, withGeoReport, enrichDadata, enrichNominatim, enrichLlm, pipelineOrder };
}

function resolveInputPath(arg: string): string {
  if (path.isAbsolute(arg)) return arg;
  const local = path.resolve(process.cwd(), arg);
  if (fs.existsSync(local)) return local;
  const repoRelative = path.resolve(process.cwd(), "../../", arg);
  return repoRelative;
}

function buildSummary(kinds: Array<"event" | "noise" | "meta">): ParseSummary {
  const totalBlocks = kinds.length;
  const events = kinds.filter((x) => x === "event").length;
  const noise = kinds.filter((x) => x === "noise").length;
  const meta = kinds.filter((x) => x === "meta").length;
  return {
    totalBlocks,
    events,
    noise,
    meta,
    eventShare: totalBlocks > 0 ? Number((events / totalBlocks).toFixed(4)) : 0,
  };
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const cli = parseParseSnapCli(process.argv);
  if (!cli.filePathArg) {
    console.error(
      "Usage: npm run parse:snap -- <path-to-snap.txt> [--geo-report] [--enrich-dadata] [--enrich-nominatim] [--enrich-llm] [--pipeline-order=catalog,llm,dadata,nominatim]",
    );
    process.exit(1);
  }

  const wantsEnrichers =
    cli.enrichDadata || cli.enrichNominatim || cli.enrichLlm;
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

  const runtime = createWorkerCompositionRoot(
    cli.withGeoReport
      ? {
          explicitEnricherFlags: {
            dadata: cli.enrichDadata,
            nominatim: cli.enrichNominatim,
            llm: cli.enrichLlm,
          },
          pipelineOrder: cli.pipelineOrder,
          llmRuntimeOverride: cli.enrichLlm ? { enabled: true } : undefined,
        }
      : { explicitEnricherFlags: false },
  );

  const source = fs.readFileSync(filePath, "utf8");
  const blocks = splitMessageBlocks(source);
  const classifier = new RuleBasedEventClassifier();
  const results = blocks.map((block, index) => ({
    index,
    block,
    result: classifier.classify(block),
  }));
  const summary = buildSummary(results.map((x) => x.result.kind));

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
        summary,
        results: results.map((x) => ({
          index: x.index,
          kind: x.result.kind,
          reason: "reason" in x.result ? x.result.reason : undefined,
          event: "event" in x.result ? x.result.event : undefined,
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
