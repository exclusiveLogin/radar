import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";
import type { DadataEnricher } from "../../../infrastructure/enrichers/dadataEnricher.js";
import { resolveEnricherGeocode } from "../../../domain/geo/geographicTextContext.js";
import type { IPlaceCacheRepository } from "@radar/shared";

export class DadataStep implements GeoPipelineStep {
  readonly id = "dadata";

  constructor(
    private readonly enricher: DadataEnricher,
    private readonly cache?: IPlaceCacheRepository,
  ) {}
  async run(ctx: GeoPipelineContext): Promise<void> {
    const catalogRegions = ctx.artifact.catalog?.regions ?? [];
    const regionCode = catalogRegions[0]?.code;
    const geocode = resolveEnricherGeocode(
      ctx.rawText,
      ctx.artifact.catalog?.places,
      catalogRegions.map((region) => ({
        code: region.code,
        name: region.name,
        aliases: [],
      })),
    );
    const queryNorm = geocode.query.toLowerCase().trim();
    const nodeName = geocode.bindPlaceName;

    if (this.cache) {
      const hit = await this.cache.get(queryNorm);
      if (hit) {
        ctx.artifact.dadata = {
          schemaVersion: 1,
          cacheHit: true,
          nodes: [
            {
              name: nodeName ?? String(hit.raw?.placeName ?? queryNorm),
              kind: nodeName ? "district" : "locality",
              regionCode: String(hit.raw?.regionCode ?? regionCode ?? ""),
              fiasId: hit.raw?.placeFias ? String(hit.raw.placeFias) : undefined,
              lat: hit.raw?.lat ? Number(hit.raw.lat) : undefined,
              lon: hit.raw?.lon ? Number(hit.raw.lon) : undefined,
            },
          ],
        };
        return;
      }
    }

    const candidate = await this.enricher.enrich({ rawText: geocode.query, regionCode });
    if (!candidate) {
      ctx.artifact.dadata = { schemaVersion: 1, cacheHit: false, nodes: [] };
      return;
    }

    if (this.cache) {
      await this.cache.put(queryNorm, candidate.provider, {
        placeName: candidate.placeName,
        regionCode: candidate.regionCode,
        placeFias: candidate.placeFias,
        lat: candidate.lat,
        lon: candidate.lon,
      });
    }

    ctx.artifact.dadata = {
      schemaVersion: 1,
      cacheHit: false,
      nodes: [
        {
          name: nodeName ?? candidate.placeName ?? queryNorm,
          kind: nodeName ? "district" : "locality",
          regionCode: candidate.regionCode ?? regionCode,
          fiasId: candidate.placeFias,
          lat: candidate.lat,
          lon: candidate.lon,
        },
      ],
    };
  }
}
