/**
 * Отчёт fold snapshot(now): факты и видимые регионы/места.
 *
 * Usage:
 *   npm run map:fold:status -w @radar/worker
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { foldMapState, loadMapFoldFacts } from "@radar/shared";
import { resolveMapStateTtlMs } from "../infrastructure/config/mapStateExpiryConfig.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const dataSource = await createWorkerDataSource();
  const asOf = new Date();
  const ttlMs = resolveMapStateTtlMs();

  const facts = await loadMapFoldFacts(dataSource, asOf, ttlMs);
  const folded = foldMapState({ asOf, ttlMs, facts });

  const report = {
    generatedAt: asOf.toISOString(),
    ttlMs,
    factsLoaded: facts.length,
    foldRegions: folded.regions.length,
    foldPlaces: folded.places.length,
    regions: folded.regions.map((region) => ({
      regionCode: region.regionCode,
      stateLevel: region.stateLevel,
      action: region.action,
      occurredAt: region.occurredAt,
    })),
    places: folded.places
      .filter((place) => place.placeId)
      .map((place) => ({
        placeId: place.placeId,
        regionCode: place.regionCode,
        stateLevel: place.stateLevel,
        occurredAt: place.occurredAt,
      })),
  };

  const outDir = path.join(MONOREPO_ROOT, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "map_fold_status.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({
    foldRegions: report.foldRegions,
    foldPlaces: report.foldPlaces,
    factsLoaded: report.factsLoaded,
    report: jsonPath,
  }, null, 2));

  await dataSource.destroy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
