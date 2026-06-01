import type { EnricherId } from "@radar/shared";
import type {
  PipelineStepId,
  ResolvedEnricherFlags,
} from "../../infrastructure/enrichers/enricherChainFactory.js";

/** Собирает флаги и порядок пайплайна из enrichers[] фазы (SSOT конфигурации фазы). */
export function pipelineConfigFromEnrichers(enrichers: EnricherId[]): {
  flags: ResolvedEnricherFlags;
  order: PipelineStepId[];
} {
  const order: PipelineStepId[] = [];
  for (const id of enrichers) {
    if (id === "rule") continue;
    if (id === "catalog" || id === "llm" || id === "dadata" || id === "nominatim") {
      order.push(id);
    }
  }
  return {
    flags: {
      llm: enrichers.includes("llm"),
      dadata: enrichers.includes("dadata"),
      nominatim: enrichers.includes("nominatim"),
    },
    order: order.length > 0 ? order : ["catalog"],
  };
}
