import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { stopAllActivePhaseRuns } from "../stopAllActivePhaseRuns.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

async function deleteOptional(dataSource: DataSource, sql: string): Promise<number> {
  try {
    const rows = (await dataSource.query(sql)) as unknown[];
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * geo:wipe — все places (операционные + catalog mirror), без structural geo-каталога.
 * regions, geo_feature, geo_dataset_file, place_geo_link остаются.
 */
export async function wipeGeoPlacesPhase(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  dryRun: boolean;
}): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "geo",
      action: "wipe",
      dryRun: true,
      counts: {},
      notes: [
        "Удалит places, place_aliases; сбросит regions.canonical_place_id.",
        "Не трогает: regions, geo_feature, place_geo_link, geo_dataset_file.",
      ],
    };
  }

  await stopAllActivePhaseRuns({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: "geo:wipe",
  });

  try {
    await input.dataSource.query(
      `UPDATE regions SET canonical_place_id = NULL WHERE canonical_place_id IS NOT NULL`,
    );
  } catch {
    // optional column
  }

  const jobs = await deleteOptional(
    input.dataSource,
    `DELETE FROM place_enrichment_jobs RETURNING id`,
  );
  const evidence = await deleteOptional(
    input.dataSource,
    `DELETE FROM event_evidence RETURNING id`,
  );
  const aliases = await deleteOptional(
    input.dataSource,
    `DELETE FROM place_aliases RETURNING id`,
  );

  // event_locations.place_id = RESTRICT — обнулить ссылку перед удалением places
  await deleteOptional(
    input.dataSource,
    `UPDATE event_locations SET place_id = NULL WHERE place_id IS NOT NULL RETURNING id`,
  );

  await input.dataSource.query(`DELETE FROM places WHERE parent_place_id IS NOT NULL`);
  const places = await deleteOptional(
    input.dataSource,
    `DELETE FROM places RETURNING id`,
  );

  return {
    phase: "geo",
    action: "wipe",
    dryRun: false,
    counts: {
      places,
      place_aliases: aliases,
      place_enrichment_jobs: jobs,
      event_evidence: evidence,
    },
  };
}

/**
 * geo:reset — снять обогащение (координаты, trust, bbox), строки places остаются.
 */
export async function resetGeoEnrichmentPhase(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  dryRun: boolean;
}): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "geo",
      action: "reset",
      dryRun: true,
      counts: {},
      notes: [
        "Обнулит centroid/bbox/trust на places; удалит place_enrichment_jobs и event_evidence.",
        "geo_feature_id и каталог regions не трогает.",
      ],
    };
  }

  await stopAllActivePhaseRuns({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: "geo:reset",
    clearGeoJobs: true,
  });

  const jobs = await deleteOptional(
    input.dataSource,
    `DELETE FROM place_enrichment_jobs RETURNING id`,
  );
  const evidence = await deleteOptional(
    input.dataSource,
    `DELETE FROM event_evidence RETURNING id`,
  );

  const updated = (await input.dataSource.query(
    `UPDATE places SET
       centroid_lat = NULL,
       centroid_lon = NULL,
       bbox = NULL,
       geometry_artifact_key = NULL,
       trust_state = 'unverified',
       is_trusted = false,
       trust_score = NULL,
       trust_updated_at = NULL,
       evidence_providers = '[]'::jsonb,
       updated_at = now()
     RETURNING id`,
  )) as Array<{ id: string }>;

  return {
    phase: "geo",
    action: "reset",
    dryRun: false,
    counts: {
      places_enrichment_cleared: updated.length,
      place_enrichment_jobs: jobs,
      event_evidence: evidence,
    },
  };
}
