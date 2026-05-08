import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";
import type { LlmEnricher } from "../../../infrastructure/enrichers/llmEnricher.js";

export class LlmStep implements GeoPipelineStep {
  readonly id = "llm";

  constructor(private readonly enricher: LlmEnricher) {}

  async run(ctx: GeoPipelineContext): Promise<void> {
    const regionCode = ctx.artifact.catalog?.regions[0]?.code;
    const candidate = await this.enricher.enrich({ rawText: ctx.rawText, regionCode });

    if (!candidate) {
      ctx.artifact.llm = {
        schemaVersion: 1,
        nodes: [],
        confidence: 0,
        reason: "no result",
      };
      return;
    }

    const raw = candidate.raw as Record<string, unknown>;
    const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
    const reason = typeof raw.reason === "string" ? raw.reason : "";

    const nodes: import("@radar/shared").GeoNode[] = [];

    if (candidate.regionCode) {
      nodes.push({
        name: candidate.regionCode,
        kind: "region",
        regionCode: candidate.regionCode,
      });
    }

    if (candidate.placeName) {
      nodes.push({
        name: candidate.placeName,
        kind: "locality",
        regionCode: candidate.regionCode,
        fiasId: candidate.placeFias,
      });
    }

    ctx.artifact.llm = {
      schemaVersion: 1,
      nodes,
      confidence,
      reason,
    };
  }
}
