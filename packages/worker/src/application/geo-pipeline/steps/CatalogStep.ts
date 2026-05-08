import type { GeoEnrichmentCatalog } from "@radar/shared";
import type { GeoCatalog } from "../../../infrastructure/geo-catalog/index.js";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

export class CatalogStep implements GeoPipelineStep {
  readonly id = "catalog";

  constructor(private readonly geoCatalog: GeoCatalog) {}

  run(ctx: GeoPipelineContext): Promise<void> {
    const regions = this.geoCatalog.findRegions(ctx.rawText);
    const regionSnapshots: GeoEnrichmentCatalog["regions"] = regions.map((r) => ({
      code: r.code,
      name: r.name,
      fiasId: r.fiasId,
    }));

    const places: GeoEnrichmentCatalog["places"] = [];

    const primaryRegion = regions[0];
    const localPlaces = primaryRegion
      ? this.geoCatalog.findPlacesInRegion(ctx.rawText, primaryRegion.code)
      : this.geoCatalog.findPlacesInRegion(ctx.rawText).filter((p) => p.kind === "city");

    for (const p of localPlaces) {
      places.push({
        name: p.name,
        kind: p.kind,
        regionCode: primaryRegion?.code,
        lat: p.lat,
        lon: p.lon,
      });
    }

    ctx.artifact.catalog = {
      schemaVersion: 1,
      regions: regionSnapshots,
      places,
    };

    return Promise.resolve();
  }
}
