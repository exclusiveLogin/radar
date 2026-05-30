import type { GeoEnrichmentCatalog } from "@radar/shared";
import { inferPreferredRegionCode } from "../../../domain/geo/geographicTextContext.js";
import type { GeoCatalog } from "../../../infrastructure/geo-catalog/index.js";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

export class CatalogStep implements GeoPipelineStep {
  readonly id = "catalog";

  constructor(private readonly geoCatalog: GeoCatalog) {}
run(ctx: GeoPipelineContext): Promise<void> {
    const anchors = this.geoCatalog.findLocalityAnchors(ctx.rawText);
    const regions = this.geoCatalog.findRegions(ctx.rawText);
    const regionSnapshots: GeoEnrichmentCatalog["regions"] = regions.map((r) => ({
      code: r.code,
      name: r.name,
      fiasId: r.fiasId,
    }));

    const places: GeoEnrichmentCatalog["places"] = [];

    const preferredCode = inferPreferredRegionCode(ctx.rawText, anchors);
    const primaryRegion =
      (preferredCode
        ? regions.find((r) => r.code === preferredCode)
        : undefined)
      ?? regions[0]
      ?? (preferredCode
        ? this.geoCatalog.getRegionByCode(preferredCode)
        : undefined);

    const localPlaces = this.geoCatalog.findPlacesInRegion(
      ctx.rawText,
      primaryRegion?.code,
    );

    for (const p of localPlaces) {
      places.push({
        name: p.name,
        kind: p.kind,
        regionCode: primaryRegion?.code ?? preferredCode ?? undefined,
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
