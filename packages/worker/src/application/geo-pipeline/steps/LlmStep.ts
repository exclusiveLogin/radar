import type { GeoNode } from "@radar/shared";
import type { LlmEnricher } from "../../../infrastructure/enrichers/llmEnricher.js";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

export class LlmStep implements GeoPipelineStep {
  readonly id = "llm";

  constructor(private readonly enricher: LlmEnricher) {}

  async run(ctx: GeoPipelineContext): Promise<void> {
    const catalogRegions = ctx.artifact.catalog?.regions ?? [];
    const regionCode = catalogRegions[0]?.code;
    const result = await this.enricher.enrich({
      rawText: ctx.rawText,
      regionCode,
      catalogRegions: catalogRegions.length > 0 ? catalogRegions : undefined,
    });

    if (!result) {
      ctx.artifact.llm = {
        schemaVersion: 1,
        nodes: [],
        confidence: 0,
        reason: "no result",
      };
      return;
    }

    const nodes: GeoNode[] = [];

    const normName = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
    // Match by first word (adjective) — handles "Калужская обл" vs "Калужская область"
    const firstWord = (s: string) => normName(s).split(/\s+/)[0] ?? "";
    const lookupRegionCode = (placeName: string): string | undefined =>
      catalogRegions.find(
        (r) => normName(r.name) === normName(placeName) || firstWord(r.name) === firstWord(placeName),
      )?.code;

    for (const place of result.places) {
      const isRegion = place.kind === "region";

      let placeRegionCode: string | undefined;
      if (isRegion) {
        // Priority: catalog lookup (exact + first-word) > LLM-provided > hint
        placeRegionCode =
          lookupRegionCode(place.placeName)
          ?? (place.regionCode ?? undefined)
          ?? result.regionCode
          ?? regionCode;
      } else {
        // Non-region: use LLM-provided regionCode for this place, else top-level hint
        placeRegionCode = (place.regionCode ?? undefined) ?? result.regionCode ?? regionCode;
      }

      nodes.push({
        name: place.placeName,
        kind: isRegion ? "region" : place.kind,
        regionCode: placeRegionCode ?? undefined,
        fiasId: place.placeFias ?? undefined,
      });
    }

    ctx.artifact.llm = {
      schemaVersion: 1,
      nodes,
      confidence: result.confidence,
      reason: result.reason,
    };
  }
}
