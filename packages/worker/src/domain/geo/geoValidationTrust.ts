import type { EventLocation, PlaceProvider, PlaceRecord } from "@radar/shared";

const TRUSTED_PROVIDERS = new Set<PlaceProvider>([
  "catalog",
  "dadata",
  "operator",
  "system",
]);

/** Нормализация подписи для match place/region. */
export function normalizeGeoLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

/** source локации → PlaceProvider для contribution. */
export function sourceToProvider(source: EventLocation["source"]): PlaceProvider {
  switch (source) {
    case "db":
      return "catalog";
    case "cache":
      return "system";
    case "dadata":
      return "dadata";
    case "nominatim":
      return "nominatim";
    case "llm":
      return "llm";
  }
}

/** Trust state из provider + confidence. */
export function toTrustState(
  provider: PlaceProvider,
  confidence: number | undefined,
): {
  trustState: PlaceRecord["trustState"];
  isTrusted: boolean;
  trustScore: number;
} {
  const scoreByProvider: Record<PlaceProvider, number> = {
    catalog: 1,
    dadata: 0.95,
    nominatim: 0.8,
    llm: 0.55,
    operator: 1,
    system: 0.7,
  };
  const trustScore = confidence ?? scoreByProvider[provider];
  const isTrusted = TRUSTED_PROVIDERS.has(provider) || trustScore >= 0.9;
  const trustState: PlaceRecord["trustState"] = isTrusted
    ? "verified"
    : trustScore >= 0.7
      ? "partially_verified"
      : "unverified";
  return { trustState, isTrusted, trustScore };
}