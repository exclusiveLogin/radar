/**
 * ---
 * layer: worker/cli
 * kind: eval-scorer
 * purpose: Сравнить профит catalog-only vs catalog+llm против golden-набора.
 * ---
 *
 * Метрики на event-блоках с разметкой: region/place precision+recall+F1,
 * kind-accuracy на совпавших локациях, false-positive geo на шуме, latency.
 * Итог — компактная таблица catalog vs +LLM и дельта профита.
 *
 * Usage:
 *   npm run parse:score -- [--input=tests] [--golden=tests/golden] [--reviewed-only]
 */
import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createProgress } from "./progress.js";
import {
  canonicalRegionCode,
  createModeResolvers,
  goldenPathFor,
  listFixtureFiles,
  loadFixtureBlocks,
  normalizePlaceName,
  readGoldenFile,
  type GoldenBlock,
  type GoldenLabel,
  type ModeResolver,
  type NormalizedLocation,
} from "./eval/evalShared.js";
import type { GeoCatalog } from "../infrastructure/geo-catalog/index.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Аккумулятор precision/recall (micro по меткам). */
type PrCounter = { tp: number; fp: number; fn: number };

type ModeScore = {
  region: PrCounter;
  place: PrCounter;
  kindMatched: number;
  kindCorrect: number;
  falsePositiveGeo: number;
  eventsExpectedGeo: number;
  eventsDetected: number;
  latencyMs: number;
};

function emptyScore(): ModeScore {
  return {
    region: { tp: 0, fp: 0, fn: 0 },
    place: { tp: 0, fp: 0, fn: 0 },
    kindMatched: 0,
    kindCorrect: 0,
    falsePositiveGeo: 0,
    eventsExpectedGeo: 0,
    eventsDetected: 0,
    latencyMs: 0,
  };
}

function f1(counter: PrCounter): {
  precision: number;
  recall: number;
  f1: number;
} {
  const precision = counter.tp / Math.max(1, counter.tp + counter.fp);
  const recall = counter.tp / Math.max(1, counter.tp + counter.fn);
  const denom = precision + recall;
  return {
    precision: round(precision),
    recall: round(recall),
    f1: round(denom > 0 ? (2 * precision * recall) / denom : 0),
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

/** Сравнивает множества меток и фактических локаций, копит TP/FP/FN. */
function scoreSets(
  expectedRegions: string[],
  actualRegions: string[],
  counter: PrCounter,
): void {
  const expected = new Set(expectedRegions);
  const actual = new Set(actualRegions);
  for (const code of actual) {
    if (expected.has(code)) counter.tp += 1;
    else counter.fp += 1;
  }
  for (const code of expected) {
    if (!actual.has(code)) counter.fn += 1;
  }
}

function expectedRegionCodes(catalog: GeoCatalog, labels: GoldenLabel[]): string[] {
  return labels.map((l) => canonicalRegionCode(catalog, l.regionCode) ?? l.regionCode);
}

function expectedPlaces(labels: GoldenLabel[]): string[] {
  return labels
    .map((l) => normalizePlaceName(l.placeName))
    .filter((p): p is string => p !== null);
}

function actualPlaces(locations: NormalizedLocation[]): string[] {
  return locations
    .map((l) => normalizePlaceName(l.placeName))
    .filter((p): p is string => p !== null);
}

/** Накопить метрики одного блока для одного режима. */
function scoreBlock(
  catalog: GeoCatalog,
  golden: GoldenBlock,
  locations: NormalizedLocation[],
  score: ModeScore,
): void {
  // Шум/мета: гео не ожидается — любая локация это false-positive.
  if (golden.expected === null) {
    if (locations.length > 0) score.falsePositiveGeo += 1;
    return;
  }

  score.eventsExpectedGeo += golden.expected.length > 0 ? 1 : 0;
  if (locations.length > 0 && golden.expected.length > 0) score.eventsDetected += 1;

  scoreSets(
    expectedRegionCodes(catalog, golden.expected),
    locations.map((l) => l.regionCode),
    score.region,
  );
  scoreSets(expectedPlaces(golden.expected), actualPlaces(locations), score.place);

  // kind-accuracy: на совпавших по (region+place) локациях сверяем precision.
  for (const label of golden.expected) {
    if (!label.precision) continue;
    const labelPlace = normalizePlaceName(label.placeName);
    const labelRegion = canonicalRegionCode(catalog, label.regionCode) ?? label.regionCode;
    const match = locations.find(
      (l) => l.regionCode === labelRegion && normalizePlaceName(l.placeName) === labelPlace,
    );
    if (!match) continue;
    score.kindMatched += 1;
    if (match.precision === label.precision) score.kindCorrect += 1;
  }
}

function renderRow(label: string, score: ModeScore, blocks: number) {
  const region = f1(score.region);
  const place = f1(score.place);
  return {
    mode: label,
    "region P/R/F1": `${region.precision}/${region.recall}/${region.f1}`,
    "place P/R/F1": `${place.precision}/${place.recall}/${place.f1}`,
    kindAcc: round(score.kindCorrect / Math.max(1, score.kindMatched)),
    detectRecall: round(score.eventsDetected / Math.max(1, score.eventsExpectedGeo)),
    fpGeoNoise: score.falsePositiveGeo,
    "avgMs/block": round(score.latencyMs / Math.max(1, blocks)),
  };
}

async function resolveTimed(
  resolver: ModeResolver,
  text: string,
  score: ModeScore,
): Promise<NormalizedLocation[]> {
  const t0 = Date.now();
  const locations = await resolver.resolve(text);
  score.latencyMs += Date.now() - t0;
  return locations;
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const input = readStringFlag(map, ["input", "in"]) ?? "tests";
  const goldenDir = readStringFlag(map, ["golden"]) ?? "tests/golden";
  const reviewedOnly = hasAnyFlag(map, ["reviewed-only"]);

  const files = listFixtureFiles(input);
  const blocks = loadFixtureBlocks(files);
  const { catalog, llm, catalogIndex } = createModeResolvers();

  const catalogScore = emptyScore();
  const llmScore = emptyScore();
  let scoredBlocks = 0;
  let missingGolden = 0;

  const goldenCache = new Map<string, ReturnType<typeof readGoldenFile>>();
  const progress = createProgress("score", blocks.length);

  for (const block of blocks) {
    progress.tick();
    if (!goldenCache.has(block.file)) {
      goldenCache.set(block.file, readGoldenFile(goldenPathFor(goldenDir, block.file)));
    }
    const goldenFile = goldenCache.get(block.file);
    const goldenBlock = goldenFile?.blocks.find((b) => b.blockIndex === block.blockIndex);
    if (!goldenBlock) {
      missingGolden += 1;
      continue;
    }
    if (reviewedOnly && !goldenBlock.reviewed) continue;

    scoredBlocks += 1;
    const catalogLocs = await resolveTimed(catalog, block.text, catalogScore);
    const llmLocs = await resolveTimed(llm, block.text, llmScore);
    scoreBlock(catalogIndex, goldenBlock, catalogLocs, catalogScore);
    scoreBlock(catalogIndex, goldenBlock, llmLocs, llmScore);
  }
  progress.stop();

  console.log(
    `\nScored: ${scoredBlocks} блоков (golden=${goldenDir}, reviewedOnly=${reviewedOnly}); без разметки: ${missingGolden}`,
  );
  console.table([
    renderRow("catalog", catalogScore, scoredBlocks),
    renderRow("catalog+llm", llmScore, scoredBlocks),
  ]);

  const catRegion = f1(catalogScore.region).f1;
  const llmRegion = f1(llmScore.region).f1;
  const catPlace = f1(catalogScore.place).f1;
  const llmPlace = f1(llmScore.place).f1;
  console.log("\n=== Профит LLM (дельта F1) ===");
  console.table({
    regionF1Delta: round(llmRegion - catRegion),
    placeF1Delta: round(llmPlace - catPlace),
    fpGeoDelta: llmScore.falsePositiveGeo - catalogScore.falsePositiveGeo,
    latencyOverheadMsPerBlock: round(
      (llmScore.latencyMs - catalogScore.latencyMs) / Math.max(1, scoredBlocks),
    ),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
