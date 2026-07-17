import { wipeGeoCatalog } from "../../archive/wipeGeoCatalog.js";
import type { WipeStepOptions } from "../../archive/wipeStepReporter.js";
import type { OperationalSql } from "../operationalSql.port.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/**
 * geo-catalog:wipe — structural каталог в БД (regions, geo_feature, geo_dataset_file).
 * Используется перед geo:run / geo:init на чистом листе.
 */
export async function wipeGeoCatalogPhase(
  input: {
    operationalSql?: OperationalSql;
    dryRun: boolean;
  } & WipeStepOptions,
): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "geo-catalog",
      action: "wipe",
      dryRun: true,
      counts: {},
      notes: [
        "TRUNCATE regions, geo_feature, place_geo_link, geo_dataset_file CASCADE.",
        "Перед этим — unlink FK и geo:wipe (places).",
      ],
    };
  }

  if (!input.operationalSql) {
    throw new Error("geo-catalog:wipe requires OperationalSql outside dry-run.");
  }

  const r = await wipeGeoCatalog(input.operationalSql, {
    includeRegions: true,
    onStep: input.onStep,
    log: input.log,
  });

  return {
    phase: "geo-catalog",
    action: "wipe",
    dryRun: false,
    counts: {
      regions: r.regionsDeleted,
      geo_feature: r.geoFeaturesDeleted,
      place_geo_link: r.placeGeoLinksDeleted,
      geo_dataset_file: r.geoDatasetFilesDeleted,
      region_state_active: r.regionStateActiveDeleted,
      region_state_history: r.regionStateHistoryDeleted,
    },
  };
}
