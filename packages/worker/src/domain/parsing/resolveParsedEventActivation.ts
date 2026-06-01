import type { GeoEnrichmentArtifact } from "@radar/shared";

export type ParsedEventActivation = {
  isActive: boolean;
  inactiveReason?: string;
};

/**
 * Решение о видимости события после merge/finalizer (ADR-003).
 * Деактивация только при наличии namespace `llm` в артефакте фазы —
 * catalog-only прогон не гасит событие.
 */
export function resolveParsedEventActivation(
  artifact: GeoEnrichmentArtifact | undefined,
): ParsedEventActivation {
  const llm = artifact?.llm;
  if (!llm) {
    return { isActive: true };
  }

  if (llm.eventCategory === "other") {
    return {
      isActive: false,
      inactiveReason: llm.reason?.trim() || "llm:event_category_other",
    };
  }

  return { isActive: true };
}
