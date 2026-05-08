import type { GeoNode } from "@radar/shared";
import type { LlmEnricher } from "../../../infrastructure/enrichers/llmEnricher.js";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

export class LlmStep implements GeoPipelineStep {
  readonly id = "llm";

  constructor(private readonly enricher: LlmEnricher) {}

  async run(ctx: GeoPipelineContext): Promise<void> {
    const regionCode = ctx.artifact.catalog?.regions[0]?.code;
    const result = await this.enricher.enrich({ rawText: ctx.rawText, regionCode });

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

    if (result.regionCode) {
      nodes.push({
        name: result.regionCode,
        kind: "region",
        regionCode: result.regionCode,
      });
    }

    for (const place of result.places) {
      nodes.push({
        name: place.placeName,
        kind: place.kind === "region" ? "region" : place.kind,
        regionCode: result.regionCode ?? regionCode,
        fiasId: place.placeFias,
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
