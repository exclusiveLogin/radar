/**
 * ---
 * layer: worker/cli
 * kind: eval-runner
 * purpose: A/B-прогон catalog-only vs catalog+llm над фикстурами одним запуском.
 * ---
 *
 * Считает, где LLM меняет вывод относительно дешёвого каталога: добавляет/убирает
 * локации, меняет регион/место. Это «дельта-профит» до сверки с golden (см. parse:score).
 *
 * Usage:
 *   npm run parse:ab -- --input=tests [--out=reports/ab.json] [--with-dadata] [--with-nominatim]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createProgress } from "./progress.js";
import {
  blockKey,
  createModeResolvers,
  listFixtureFiles,
  loadFixtureBlocks,
  type NormalizedLocation,
} from "./eval/evalShared.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Сравнимая подпись локации (регион+место) без precision/source. */
function locationSignature(loc: NormalizedLocation): string {
  return `${loc.regionCode}|${loc.placeName ?? ""}`;
}

function diffLocations(
  catalog: NormalizedLocation[],
  llm: NormalizedLocation[],
): { added: NormalizedLocation[]; removed: NormalizedLocation[]; same: number } {
  const catalogSet = new Set(catalog.map(locationSignature));
  const llmSet = new Set(llm.map(locationSignature));
  const added = llm.filter((loc) => !catalogSet.has(locationSignature(loc)));
  const removed = catalog.filter((loc) => !llmSet.has(locationSignature(loc)));
  const same = catalog.filter((loc) => llmSet.has(locationSignature(loc))).length;
  return { added, removed, same };
}

type BlockReport = {
  key: string;
  file: string;
  blockIndex: number;
  kind: "event" | "noise" | "meta";
  catalog: NormalizedLocation[];
  llm: NormalizedLocation[];
  added: NormalizedLocation[];
  removed: NormalizedLocation[];
  changed: boolean;
};

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const input = readStringFlag(map, ["input", "in"]) ?? "tests";
  const outPath = readStringFlag(map, ["out"]) ?? "reports/ab.json";
  const withDadata = hasAnyFlag(map, ["with-dadata"]);
  const withNominatim = hasAnyFlag(map, ["with-nominatim"]);

  const files = listFixtureFiles(input);
  const blocks = loadFixtureBlocks(files).filter((b) => b.kind === "event");
  console.log(
    `A/B: ${files.length} файлов, ${blocks.length} event-блоков; llm(dadata=${withDadata}, nominatim=${withNominatim})`,
  );

  const { catalog, llm } = createModeResolvers({ withDadata, withNominatim });

  const reports: BlockReport[] = [];
  let catalogLatency = 0;
  let llmLatency = 0;
  const progress = createProgress("A/B", blocks.length);

  for (const block of blocks) {
    const t0 = Date.now();
    const catalogLocs = await catalog.resolve(block.text);
    const t1 = Date.now();
    const llmLocs = await llm.resolve(block.text);
    const t2 = Date.now();
    catalogLatency += t1 - t0;
    llmLatency += t2 - t1;

    const { added, removed } = diffLocations(catalogLocs, llmLocs);
    const changed = added.length > 0 || removed.length > 0;
    reports.push({
      key: blockKey(block.file, block.blockIndex),
      file: block.file,
      blockIndex: block.blockIndex,
      kind: block.kind,
      catalog: catalogLocs,
      llm: llmLocs,
      added,
      removed,
      changed,
    });
    progress.tick(1, { changed: reports.filter((r) => r.changed).length });
  }
  progress.stop();

  const changedBlocks = reports.filter((r) => r.changed);
  const llmAddedGeo = reports.filter(
    (r) => r.catalog.length === 0 && r.llm.length > 0,
  ).length;
  const llmRemovedGeo = reports.filter(
    (r) => r.catalog.length > 0 && r.llm.length === 0,
  ).length;
  const regionChanged = reports.filter((r) =>
    r.added.some((a) =>
      r.removed.some((rm) => rm.placeName === a.placeName && rm.regionCode !== a.regionCode),
    ),
  ).length;

  const summary = {
    files: files.length,
    eventBlocks: blocks.length,
    changedBlocks: changedBlocks.length,
    llmAddedGeo,
    llmRemovedGeo,
    regionChanged,
    avgLatencyMs: {
      catalog: Number((catalogLatency / Math.max(1, blocks.length)).toFixed(2)),
      llm: Number((llmLatency / Math.max(1, blocks.length)).toFixed(2)),
    },
  };

  const absOut = path.isAbsolute(outPath)
    ? outPath
    : path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify({ summary, blocks: reports }, null, 2), "utf8");

  console.log("\n=== A/B summary ===");
  console.table(summary);
  console.log(`Отчёт: ${absOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
