import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import {
  countTableRows,
  runSqlOptional,
  truncateGroupCounted,
  truncateTableCounted,
} from "../../archive/wipeTableSql.js";
import { runWipeStep, type WipeStepOptions } from "../../archive/wipeStepReporter.js";
import { stopAllActivePhaseRuns } from "../stopAllActivePhaseRuns.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

const PLACES_TRUNCATE_TABLES = [
  "job_geo_place_enrich",
  "mat_parse_evidence",
  "place_aliases",
  "places",
] as const;

/**
 * geo:wipe — все places (операционные + catalog mirror), без structural geo-каталога.
 */
export async function wipeGeoPlacesPhase(
  input: {
    dataSource: DataSource;
    repos: WorkerDbRepositories;
    dryRun: boolean;
  } & WipeStepOptions,
): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "geo",
      action: "wipe",
      dryRun: true,
      counts: {},
      notes: [
        "TRUNCATE places CASCADE (aliases, jobs, place_geo_link).",
        "Сбросит regions.canonical_place_id.",
        "Не трогает: regions, geo_feature, geo_dataset_file.",
      ],
    };
  }

  const { dataSource } = input;

  await runWipeStep(input, "остановка log_parse_phase_run (geo)", async () => {
    const stopped = await stopAllActivePhaseRuns({
      dataSource,
      repos: input.repos,
      reason: "geo:wipe",
    });
    input.log?.detail(
      `geo stop: log_parse_phase_run=${stopped.phaseRunsClosed}, geo_jobs=${stopped.geoJobsCleared}`,
    );
    return stopped.phaseRunsClosed + stopped.geoJobsCleared;
  });

  await runWipeStep(input, "unlink FK (regions, mat_parse_location)", async () => {
    await runSqlOptional(
      dataSource,
      `UPDATE regions SET canonical_place_id = NULL WHERE canonical_place_id IS NOT NULL`,
      input.log,
    );
    await runSqlOptional(
      dataSource,
      `UPDATE mat_parse_location SET place_id = NULL WHERE place_id IS NOT NULL`,
      input.log,
    );
    return 0;
  });

  const places = await runWipeStep(input, "places + зависимости (TRUNCATE CASCADE)", async () => {
    input.log?.detail(`таблицы: ${PLACES_TRUNCATE_TABLES.join(", ")}`);
    const placesCount = await countTableRows(dataSource, "places", input.log);
    await truncateGroupCounted(dataSource, [...PLACES_TRUNCATE_TABLES], {
      cascade: true,
      log: input.log,
      forceLocks: input.forceLocks,
    });
    return placesCount;
  });

  return {
    phase: "geo",
    action: "wipe",
    dryRun: false,
    counts: { places },
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
        "Обнулит centroid/bbox/trust на places; TRUNCATE mat_parse_evidence. Jobs сохраняются.",
        "geo_feature_id и каталог regions не трогает.",
      ],
    };
  }

  await stopAllActivePhaseRuns({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: "geo:reset",
    clearGeoJobs: false,
  });

  const evidence = await truncateTableCounted(input.dataSource, "mat_parse_evidence");

  const placesBefore = await countTableRows(input.dataSource, "places");
  await input.dataSource.query(
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
       updated_at = now()`,
  );

  return {
    phase: "geo",
    action: "reset",
    dryRun: false,
    counts: {
      places_enrichment_cleared: placesBefore,
      mat_parse_evidence: evidence,
    },
  };
}
