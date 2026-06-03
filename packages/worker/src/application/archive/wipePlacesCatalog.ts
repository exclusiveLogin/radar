import type { DataSource } from "typeorm";
import { clearOperationalMapState } from "../archive/clearOperationalMapState.js";
import { clearParsedArtifacts } from "../phases/pipelineOperationalReset.js";
import { stopAllActivePhaseRuns } from "../phases/stopAllActivePhaseRuns.js";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";

export type WipePlacesCatalogResult = {
  regionsCanonicalCleared: number;
  enrichmentJobsDeleted: number;
  eventEvidenceDeleted: number;
  aliasesDeleted: number;
  placeCacheDeleted: number;
  placesDeleted: number;
};

/**
 * Полное удаление справочника places (+ aliases, geo jobs).
 * regions остаётся; канон восстанавливается через npm run geo:db:apply.
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

  let regionsCanonicalCleared = 0;
  try {
    const canonicalRows = (await dataSource.query(
      `UPDATE regions SET canonical_place_id = NULL WHERE canonical_place_id IS NOT NULL RETURNING id`,
    )) as Array<{ id: string }>;
    regionsCanonicalCleared = canonicalRows.length;
  } catch {
    // колонка optional (миграция region-canonical не на всех стендах)
  }

  const jobsRows = (await dataSource.query(
    `DELETE FROM place_enrichment_jobs RETURNING id`,
  )) as Array<{ id: string }>;

  const evidenceRows = (await dataSource.query(
    `DELETE FROM event_evidence RETURNING id`,
  )) as Array<{ id: string }>;

  const aliasRows = (await dataSource.query(
    `DELETE FROM place_aliases RETURNING id`,
  )) as Array<{ id: string }>;

  await dataSource.query(`DELETE FROM places WHERE parent_place_id IS NOT NULL`);
  const placeRows = (await dataSource.query(
    `DELETE FROM places RETURNING id`,
  )) as Array<{ id: string }>;

  return {
    regionsCanonicalCleared,
    enrichmentJobsDeleted: jobsRows.length,
    eventEvidenceDeleted: evidenceRows.length,
    aliasesDeleted: aliasRows.length,
    placeCacheDeleted: 0,
    placesDeleted: placeRows.length,
  };
}
