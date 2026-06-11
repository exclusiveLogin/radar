import { MONOREPO_ROOT } from "@repo/root";
import { foldMapState, loadMapFoldFacts } from "@radar/shared";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { resolveMapStateTtlMs } from "@radar/shared";

/** Диагностика fold read-line: видимые регионы/места на now. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const ttlMs = resolveMapStateTtlMs(process.env);
  const dataSource = await createWorkerDataSource();
  const asOf = new Date();
  const cutoff = new Date(asOf.getTime() - ttlMs).toISOString();

  const facts = await loadMapFoldFacts(dataSource, asOf, ttlMs);
  const folded = foldMapState({ asOf, ttlMs, facts });

  const activeRegions = folded.regions
    .filter((region) => region.stateLevel !== "grey")
    .map((region) => ({
      regionCode: region.regionCode,
      stateLevel: region.stateLevel,
      action: region.action,
      occurredAt: region.occurredAt,
      ageMs: asOf.getTime() - Date.parse(region.occurredAt),
    }))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  const activePlaces = folded.places
    .filter((place) => place.placeId)
    .map((place) => ({
      placeId: place.placeId,
      regionCode: place.regionCode,
      stateLevel: place.stateLevel,
      occurredAt: place.occurredAt,
      ageMs: asOf.getTime() - Date.parse(place.occurredAt),
    }))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  console.log(JSON.stringify({
    ttlMs,
    ttlHours: ttlMs / (60 * 60 * 1000),
    cutoff,
    factsLoaded: facts.length,
    foldRegions: folded.regions.length,
    foldPlaces: folded.places.length,
    activeRaiseRegions: activeRegions,
    activeRaisePlaces: activePlaces,
  }, null, 2));

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
