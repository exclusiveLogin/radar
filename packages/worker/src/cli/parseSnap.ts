import * as fs from "node:fs";
import * as path from "node:path";
import type { ILocationEnricher, LocationCandidate } from "@radar/shared";
import { GeoValidationService } from "../application/parsing/geoValidationService.js";
import { LocationResolutionService } from "../application/parsing/locationResolutionService.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../application/handlers/inMemoryRepositories.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { splitMessageBlocks } from "../domain/parsing/index.js";

// CLI для оффлайн прогона parser на сохраненных snapshot-текстах.
// Нужен для быстрой проверки качества классификации без подключения Telegram.
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
};

class NoopEnricher implements ILocationEnricher {
  readonly name = "dadata";

  async enrich(_input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null> {
    // В snapshot-режиме внешние enrichers не вызываем.
    return null;
  }
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
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error("Usage: npm run parse:snap -- <path-to-snap.txt>");
    process.exit(1);
  }
  const withGeoReport = process.argv.includes("--geo-report");

  const filePath = resolveInputPath(inputArg);
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

  if (withGeoReport) {
    const resolver = new LocationResolutionService(new NoopEnricher());
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
