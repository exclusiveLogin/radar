import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";
import type { NominatimEnricher } from "../../../infrastructure/enrichers/nominatimEnricher.js";
import type { IPlaceCacheRepository } from "@radar/shared";

export class NominatimStep implements GeoPipelineStep {
  readonly id = "nominatim";

  constructor(
    private readonly enricher: NominatimEnricher,
    private readonly cache?: IPlaceCacheRepository,
  ) {}

  async run(ctx: GeoPipelineContext): Promise<void> {
    const regionCode = ctx.artifact.catalog?.regions[0]?.code
      ?? ctx.artifact.llm?.nodes.find((n) => n.kind === "region")?.regionCode;
    const queryNorm = ctx.rawText.toLowerCase().trim();

    if (this.cache) {
      const hit = await this.cache.get(`nominatim:${queryNorm}`);
      if (hit) {
        ctx.artifact.nominatim = {
          schemaVersion: 1,
          cacheHit: true,
          nodes: [
            {
              name: String(hit.raw?.placeName ?? queryNorm),
              kind: "locality",
              regionCode: String(hit.raw?.regionCode ?? regionCode ?? ""),
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
      ctx.artifact.nominatim = { schemaVersion: 1, cacheHit: false, nodes: [] };
      return;
    }

    if (this.cache) {
      await this.cache.put(`nominatim:${queryNorm}`, candidate.provider, {
        placeName: candidate.placeName,
        regionCode: candidate.regionCode,
        lat: candidate.lat,
        lon: candidate.lon,
      });
    }

    ctx.artifact.nominatim = {
      schemaVersion: 1,
      cacheHit: false,
      nodes: [
        {
          name: candidate.placeName ?? queryNorm,
          kind: "locality",
          regionCode: candidate.regionCode ?? regionCode,
          lat: candidate.lat,
          lon: candidate.lon,
        },
      ],
    };
  }
}
