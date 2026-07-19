import type { GeoEnrichmentArtifact, ParseWorkspace } from "@radar/shared";
import { listActiveCandidates } from "./parseProcessorContract.js";

/**
 * Заполняет catalog slice в geoArtifact из активных candidates workspace,
 * если slice ещё не задан (phase_enrich после load из БД).
 */
export function syncCatalogArtifactFromWorkspace(
  artifact: GeoEnrichmentArtifact,
  workspace: ParseWorkspace,
): void {
  if (artifact.catalog?.regions?.length || artifact.catalog?.places?.length) {
    return;
  }

  const regions: NonNullable<GeoEnrichmentArtifact["catalog"]>["regions"] = [];
  const places: NonNullable<GeoEnrichmentArtifact["catalog"]>["places"] = [];
  const regionCodes = new Set<string>();

  for (const candidate of listActiveCandidates(workspace)) {
    const { anchor } = candidate;
    if (anchor.kind === "region" && anchor.regionCode && anchor.name) {
      if (regionCodes.has(anchor.regionCode)) continue;
      regionCodes.add(anchor.regionCode);
      regions.push({
        code: anchor.regionCode,
        name: anchor.name,
        fiasId: anchor.placeFias,
      });
      continue;
    }
    if (anchor.kind === "place" && anchor.name) {
      places.push({
        name: anchor.name,
        kind: "locality",
        regionCode: anchor.regionCode,
        lat: anchor.lat,
        lon: anchor.lon,
      });
    }
  }

  if (regions.length > 0 || places.length > 0) {
    artifact.catalog = { schemaVersion: 1, regions, places };
  }
}
