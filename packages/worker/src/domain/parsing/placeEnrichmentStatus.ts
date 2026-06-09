import type { PlaceEnrichmentProvider } from "@radar/shared";

/** Стандартный last_error для пустого ответа геокодера (не done, подлежит sweep). */
export function enrichmentMissError(provider: PlaceEnrichmentProvider): string {
  return `${provider}:miss`;
}

/** Job — промах геокодера (в т.ч. legacy no enrichment result). */
export function isEnrichmentJobMiss(lastError: string | null | undefined): boolean {
  if (!lastError) return false;
  return /:miss$/i.test(lastError) || /no enrichment result/i.test(lastError);
}
