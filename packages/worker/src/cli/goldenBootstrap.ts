/**
 * ---
 * layer: worker/cli
 * kind: eval-bootstrap
 * purpose: Генерация черновых golden-меток из вывода парсера для ручной правки.
 * ---
 *
 * Засевает `tests/golden/<fixture>.expected.json` метками из выбранного режима
 * (по умолчанию catalog — быстро и детерминированно). Метки помечены reviewed=false:
 * scorer покажет, сколько ещё не выверено руками. noise/meta → expected=null.
 *
 * Usage:
 *   npm run parse:golden:bootstrap -- --input=tests [--out=tests/golden] [--mode=catalog|llm]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createProgress } from "./progress.js";
import {
  createModeResolvers,
  goldenPathFor,
  listFixtureFiles,
  loadFixtureBlocks,
  type EvalMode,
  type GoldenBlock,
  type GoldenFile,
  type GoldenLabel,
  type ModeResolver,
} from "./eval/evalShared.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";
import type { GeoCatalog } from "../infrastructure/geo-catalog/index.js";

function toLabels(
  catalog: GeoCatalog,
  locations: Awaited<ReturnType<ModeResolver["resolve"]>>,
): GoldenLabel[] {
  return locations.map((loc) => ({
    regionCode: loc.regionCode,
    regionName: catalog.getRegionByCode(loc.regionCode)?.name,
    placeName: loc.placeName,
    precision: loc.precision,
  }));
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const input = readStringFlag(map, ["input", "in"]) ?? "tests";
  const outDir = readStringFlag(map, ["out"]) ?? "tests/golden";
  const mode = (readStringFlag(map, ["mode"]) ?? "catalog") as EvalMode;

  const files = listFixtureFiles(input);
  const blocks = loadFixtureBlocks(files);
  const eventCount = blocks.filter((b) => b.kind === "event").length;
  console.log(
    `Golden bootstrap: ${files.length} файлов, ${blocks.length} блоков (${eventCount} событий), seed=${mode}`,
  );

  const resolvers = createModeResolvers();
  const resolver = mode === "llm" ? resolvers.llm : resolvers.catalog;
  const catalog = resolvers.catalogIndex;

  const byFixture = new Map<string, GoldenBlock[]>();
  const progress = createProgress("golden", blocks.length);

  for (const block of blocks) {
    const expected =
      block.kind === "event"
        ? toLabels(catalog, await resolver.resolve(block.text))
        : null;
    const list = byFixture.get(block.file) ?? [];
    list.push({
      blockIndex: block.blockIndex,
      kind: block.kind,
      reviewed: false,
      expected,
    });
    byFixture.set(block.file, list);
    progress.tick();
  }
  progress.stop();

  const absOutDir = path.isAbsolute(outDir)
    ? outDir
    : path.resolve(process.cwd(), outDir);
  fs.mkdirSync(absOutDir, { recursive: true });

  for (const [fixture, fixtureBlocks] of byFixture) {
    const golden: GoldenFile = { fixture, seededFrom: mode, blocks: fixtureBlocks };
    const target = goldenPathFor(absOutDir, fixture);
    fs.writeFileSync(target, JSON.stringify(golden, null, 2), "utf8");
    console.log(`  ${fixture} → ${path.basename(target)} (${fixtureBlocks.length} блоков)`);
  }

  console.log(
    `\nГотово. Проверьте метки руками (reviewed:true для выверенных), приоритет — расхождения LLM vs catalog.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
