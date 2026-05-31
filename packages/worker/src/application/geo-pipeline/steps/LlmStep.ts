import type { GeoNode } from "@radar/shared";
import {
  inferPreferredRegionCode,
  isBlockedRegionCatalogLookup,
  shouldDropRegionAssignment,
} from "../../../domain/geo/geographicTextContext.js";
import type { GeoCatalog } from "../../../infrastructure/geo-catalog/index.js";
import type { LlmEnricher } from "../../../infrastructure/enrichers/llmEnricher.js";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

export class LlmStep implements GeoPipelineStep {
  readonly id = "llm";

  constructor(
    private readonly enricher: LlmEnricher,
    private readonly geoCatalog: GeoCatalog,
  ) {}

  async run(ctx: GeoPipelineContext): Promise<void> {
    const catalogRegions = ctx.artifact.catalog?.regions ?? [];
    const anchors = this.geoCatalog.findLocalityAnchors(ctx.rawText);
    const regionCode = catalogRegions[0]?.code;
    const result = await this.enricher.enrich({
      rawText: ctx.rawText,
      regionCode,
      catalogRegions: catalogRegions.length > 0 ? catalogRegions : undefined,
      localityAnchors: anchors.length > 0 ? anchors : undefined,
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
    const firstWord = (s: string) => normName(s).split(/\s+/)[0] ?? "";

    const lookupRegionCode = (placeName: string): string | undefined => {
      const exact = catalogRegions.find(
        (r) => normName(r.name) === normName(placeName),
      );
      if (exact) {
        return exact.code;
      }
      return catalogRegions.find(
        (r) =>
          firstWord(r.name) === firstWord(placeName) &&
          !isBlockedRegionCatalogLookup(
            placeName,
            r.name,
            r.code,
            anchors,
          ),
      )?.code;
    };

    const regionMeta = (code: string) => ({
      code,
      name: catalogRegions.find((r) => r.code === code)?.name ?? code,
      aliases: [] as string[],
    });

    const sanitizeRegionCode = (code: string | undefined | null): string | undefined => {
      if (!code) {
        return undefined;
      }
      const region = regionMeta(code);
      if (shouldDropRegionAssignment(ctx.rawText, code, region, anchors)) {
        return inferPreferredRegionCode(ctx.rawText, anchors) ?? undefined;
      }
      return code;
    };

    for (const place of result.places) {
      const isRegion = place.kind === "region";

      let placeRegionCode: string | undefined;
      if (isRegion) {
        placeRegionCode = sanitizeRegionCode(
          lookupRegionCode(place.placeName)
          ?? place.regionCode
          ?? result.regionCode
          ?? regionCode,
        );
      } else {
        placeRegionCode = sanitizeRegionCode(
          place.regionCode ?? result.regionCode ?? regionCode,
        );
      }

      nodes.push({
        name: place.placeName,
        kind: isRegion ? "region" : place.kind,
        regionCode: placeRegionCode ?? undefined,
        fiasId: place.placeFias ?? undefined,
        confidence: place.confidence ?? result.confidence,
        reason: place.reason ?? undefined,
      });
    }

    ctx.artifact.llm = {
      schemaVersion: 1,
      nodes,
      confidence: result.confidence,
      reason: result.reason,
      eventCategory: result.eventCategory ?? undefined,
    };
  }
}
