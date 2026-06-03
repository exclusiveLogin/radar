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

  const jobsRows = (await dataSource.query(
    `DELETE FROM place_enrichment_jobs RETURNING id`,
  )) as Array<{ id: string }>;

  const evidenceRows = (await dataSource.query(
    `DELETE FROM event_evidence RETURNING id`,
  )) as Array<{ id: string }>;

  const geo = await wipeGeoPlacesPhase({
    dataSource,
    repos,
    dryRun: false,
  });

  return {
    regionsCanonicalCleared: 0,
    enrichmentJobsDeleted: jobsRows.length,
    eventEvidenceDeleted: evidenceRows.length,
    aliasesDeleted: geo.counts.place_aliases ?? 0,
    placeCacheDeleted: 0,
    placesDeleted: geo.counts.places ?? 0,
  };
}
