import {
  countTableRows,
  runSqlOptional,
  truncateGroupCounted,
  truncateTableCounted,
} from "../../archive/wipeTableSql.js";
import { runWipeStep, type WipeStepOptions } from "../../archive/wipeStepReporter.js";
import { stopAllActivePhaseRuns } from "../stopAllActivePhaseRuns.js";
import type { PhaseOperationalDeps } from "../phaseOperationalDeps.js";
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
    deps: PhaseOperationalDeps;
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

  const { operationalSql } = input.deps;

  await runWipeStep(input, "остановка log_parse_phase_run (geo)", async () => {
    const stopped = await stopAllActivePhaseRuns({
      deps: input.deps,
      reason: "geo:wipe",
    });
    input.log?.detail(
      `geo stop: log_parse_phase_run=${stopped.phaseRunsClosed}, geo_jobs=${stopped.geoJobsCleared}`,
    );
    return stopped.phaseRunsClosed + stopped.geoJobsCleared;
  });

  await runWipeStep(input, "unlink FK (regions, mat_parse_location)", async () => {
    await runSqlOptional(
      operationalSql,
      `UPDATE regions SET canonical_place_id = NULL WHERE canonical_place_id IS NOT NULL`,
      input.log,
    );
    await runSqlOptional(
      operationalSql,
      `UPDATE mat_parse_location SET place_id = NULL WHERE place_id IS NOT NULL`,
      input.log,
    );
    return 0;
  });

  const places = await runWipeStep(input, "places + зависимости (TRUNCATE CASCADE)", async () => {
    input.log?.detail(`таблицы: ${PLACES_TRUNCATE_TABLES.join(", ")}`);
    const placesCount = await countTableRows(operationalSql, "places", input.log);
    await truncateGroupCounted(operationalSql, [...PLACES_TRUNCATE_TABLES], {
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
  deps: PhaseOperationalDeps;
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
    deps: input.deps,
    reason: "geo:reset",
    clearGeoJobs: false,
  });

  const evidence = await truncateTableCounted(input.deps.operationalSql, "mat_parse_evidence");

  const placesBefore = await countTableRows(input.deps.operationalSql, "places");
  await input.deps.operationalSql.query(
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
