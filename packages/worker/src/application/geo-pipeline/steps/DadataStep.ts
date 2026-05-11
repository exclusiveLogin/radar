import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";
import type { DadataEnricher } from "../../../infrastructure/enrichers/dadataEnricher.js";
import type { IPlaceCacheRepository } from "@radar/shared";

export class DadataStep implements GeoPipelineStep {
  readonly id = "dadata";

  constructor(
    private readonly enricher: DadataEnricher,
    private readonly cache?: IPlaceCacheRepository,
  ) {}async run(ctx: GeoPipelineContext): Promise<void> {
    const regionCode = ctx.artifact.catalog?.regions[0]?.code;
    const queryNorm = ctx.rawText.toLowerCase().trim();

    if (this.cache) {
      const hit = await this.cache.get(queryNorm);
      if (hit) {
        ctx.artifact.dadata = {
          schemaVersion: 1,
          cacheHit: true,
          nodes: [
            {
              name: String(hit.raw?.placeName ?? queryNorm),
              kind: "locality",
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

    const candidate = await this.enricher.enrich({ rawText: ctx.rawText, regionCode });
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
          name: candidate.placeName ?? queryNorm,
          kind: "locality",
          regionCode: candidate.regionCode,
          fiasId: candidate.placeFias,
          lat: candidate.lat,
          lon: candidate.lon,
        },
      ],
    };
  }
}
