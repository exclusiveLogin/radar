/**
 * ---
 * layer: shared/pipeline
 * purpose: Маппинг phase.scope → step.id из pipeline.manifest.
 * ---
 */
import type { PhaseScope } from "../schemas/enrichment/phase.js";

/** Scope фазы → id шага declarative pipeline. */
export function stepIdForPhaseScope(scope: PhaseScope): "parse" | "geo-enrich" {
  return scope === "geoParse" ? "geo-enrich" : "parse";
}
