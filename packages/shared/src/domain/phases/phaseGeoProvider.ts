import type { PlaceEnrichmentProvider } from "../../ports/repositories.js";
import type { PhaseManifestEntry } from "../../schemas/enrichment/phase.js";

/** Провайдер geoParse-фазы из enrichers (один внешний источник на фазу). */
export function resolveGeoEnrichmentProvider(
  phase: Pick<PhaseManifestEntry, "enrichers">,
): PlaceEnrichmentProvider | null {
  if (phase.enrichers.includes("llm")) return "llm";
  if (phase.enrichers.includes("dadata")) return "dadata";
  if (phase.enrichers.includes("nominatim")) return "nominatim";
  return null;
}
