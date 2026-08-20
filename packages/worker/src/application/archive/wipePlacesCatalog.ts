import { clearOperationalMapState } from "../archive/clearOperationalMapState.js";
import { clearParsedArtifacts } from "../phases/pipelineOperationalReset.js";
import { stopAllActivePhaseRuns } from "../phases/stopAllActivePhaseRuns.js";
import { wipeGeoPlacesPhase } from "../phases/lifecycle/geoPhase.js";
import type { PhaseOperationalDeps } from "../phases/phaseOperationalDeps.js";

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
  deps: PhaseOperationalDeps;
}): Promise<WipePlacesCatalogResult> {
  const { operationalSql } = input.deps;

  await stopAllActivePhaseRuns({
    deps: input.deps,
    reason: "catalog:wipe-places",
  });
  await clearOperationalMapState(operationalSql, "catalog:wipe-places");
  await clearParsedArtifacts(operationalSql);

  const geo = await wipeGeoPlacesPhase({
    deps: input.deps,
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
