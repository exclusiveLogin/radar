import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import type { ILocationEnricher } from "@radar/shared";
import { GeoValidationService } from "../application/parsing/geoValidationService.js";
import { LocationResolutionService } from "../application/parsing/locationResolutionService.js";
import { GeoCatalog } from "../infrastructure/geo-catalog/index.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceCacheRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../application/handlers/inMemoryRepositories.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import {
  buildEnricherChain,
  CachingEnricher,
  wrapEnricherFallback,
} from "../infrastructure/enrichers/index.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";

// CLI for offline parser runs on saved snapshot texts.
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
};

function parseParseSnapCli(argv: string[]): ParsedCli {
  const tokens = argv.slice(2);
  let filePathArg = "";
  let withGeoReport = false;
  let enrichDadata = false;
  let enrichNominatim = false;
  let enrichLlm = false;

  for (const t of tokens) {
    if (t.startsWith("--")) {
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

  return { filePathArg, withGeoReport, enrichDadata, enrichNominatim, enrichLlm };
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

function buildGeoReportEnricher(cli: ParsedCli): ILocationEnricher {
  const anyEnrich = cli.enrichDadata || cli.enrichNominatim || cli.enrichLlm;
  if (!anyEnrich) {
    return wrapEnricherFallback([]);
  }
  const llmRuntimeConfig = loadLlmRuntimeConfig();
  const llmConfigForRun = cli.enrichLlm
    ? { ...llmRuntimeConfig, enabled: true }
    : llmRuntimeConfig;
  const chain = buildEnricherChain(
    {
      dadata: cli.enrichDadata,
      nominatim: cli.enrichNominatim,
      llm: cli.enrichLlm,
    },
    llmConfigForRun,
    process.env.DADATA_TOKEN,
  );
  const composite = wrapEnricherFallback(chain);
  return new CachingEnricher(composite, new InMemoryPlaceCacheRepository());
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const cli = parseParseSnapCli(process.argv);
  if (!cli.filePathArg) {
    console.error(
      "Usage: npm run parse:snap -- <path-to-snap.txt> [--geo-report] [--dadataEnrich|--enrich-dadata] [--nominatimEnrich|--enrich-nominatim] [--llmEnrich|--enrich-llm]",
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
    const resolver = new LocationResolutionService(
      GeoCatalog.loadFromArtifacts(),
      buildGeoReportEnricher(cli),
    );
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
      const resolved = await resolver.resolve(row.block);
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
