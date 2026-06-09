import type { EventLocation } from "@radar/shared";

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").trim();
}

/** Ключ дедупликации: region + kind + place name. */
function locationMergeKey(location: EventLocation): string {
  const kind =
    location.entityKind
    ?? (location.precision === "region" ? "region" : location.placeId ? "place" : "place");
  const placeName = normalize(location.placeName ?? "");
  return `${location.regionCode ?? ""}|${kind}|${placeName}`;
}

/**
 * Объединяет prior evloc с delta enrich-фазы.
 * Incoming перезаписывает совпадающий ключ (уточнение place/region).
 */
export function mergeEventLocations(
  prior: EventLocation[],
  incoming: EventLocation[],
): EventLocation[] {
  if (incoming.length === 0) {
    return prior;
  }
  const merged = new Map<string, EventLocation>();
  for (const location of prior) {
    merged.set(locationMergeKey(location), location);
  }
  for (const location of incoming) {
    merged.set(locationMergeKey(location), location);
  }
  return [...merged.values()];
}

/** LLM явно классифицировал сообщение как шум/promo — можно деактивировать. */
export function isLlmExplicitDeactivate(
  artifact: { llm?: { eventCategory?: string; reason?: string } } | undefined,
): boolean {
  const llm = artifact?.llm;
  if (!llm || llm.eventCategory !== "other") {
    return false;
  }
  return Boolean(llm.reason?.trim());
}
