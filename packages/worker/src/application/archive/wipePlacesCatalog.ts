import type { DataSource } from "typeorm";
import { clearOperationalMapState } from "../archive/clearOperationalMapState.js";
import { clearParsedArtifacts } from "../phases/pipelineOperationalReset.js";
import { stopAllActivePhaseRuns } from "../phases/stopAllActivePhaseRuns.js";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { wipeGeoPlacesPhase } from "../phases/lifecycle/geoPhase.js";

export type WipePlacesCatalogResult = {
  regionsCanonicalCleared: number;
  enrichmentJobsDeleted: number;
  eventEvidenceDeleted: number;
  aliasesDeleted: number;
  placeCacheDeleted: number;
  placesDeleted: number;
};

/**
 * Удаление places + aliases (+ parse/map срез). regions остаётся.
 * Для полного сброса с raw и regions: npm run system:reset -- --confirm
 */
export async function wipePlacesCatalog(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
}): Promise<WipePlacesCatalogResult> {
  const { dataSource, repos } = input;

  await stopAllActivePhaseRuns({
    dataSource,
    repos,
    reason: "catalog:wipe-places",
  });
  await clearOperationalMapState(dataSource, "catalog:wipe-places");
  await clearParsedArtifacts(dataSource);

  const geo = await wipeGeoPlacesPhase({
    dataSource,
    repos,
    dryRun: false,
  });

  return {
    regionsCanonicalCleared: 0,
    enrichmentJobsDeleted: 0,
    eventEvidenceDeleted: 0,
    aliasesDeleted: 0,
    placeCacheDeleted: 0,
    placesDeleted: geo.counts.places ?? 0,
  };
}
