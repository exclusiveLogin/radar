/**
 * SSOT контракт RMQ wake для parse/geo/tracking (ADR-025 / queue debts).
 * mode выводится из наличия ids: targeted | drain.
 */
export type PipelineWakePayload = {
  pipelineKey: "parse" | "geo-enrich" | "tracking";
  phaseId?: string;
  /** materialization ids (rawMessageId / placeId / eventLocationId) */
  ids?: string[];
};

export type PipelineWakeMode = "targeted" | "drain";

export function resolvePipelineWakeMode(payload: PipelineWakePayload): PipelineWakeMode {
  return payload.ids && payload.ids.length > 0 ? "targeted" : "drain";
}

/** Ids из DomainEvent aggregateId или payload.materializationIds / placeIds. */
export function extractWakeIds(input: {
  aggregateId?: string | null;
  payload?: Record<string, unknown>;
}): string[] {
  const fromPayload = input.payload?.materializationIds ?? input.payload?.placeIds;
  if (Array.isArray(fromPayload)) {
    return fromPayload.map(String).filter((id) => id.length > 0);
  }
  if (input.aggregateId) return [input.aggregateId];
  return [];
}

/** placeId из MessageParsed locations payload. */
export function extractPlaceIdsFromParsedPayload(
  payload: Record<string, unknown>,
): string[] {
  const locations = payload.locations;
  if (!Array.isArray(locations)) return [];
  const ids = new Set<string>();
  for (const loc of locations) {
    if (!loc || typeof loc !== "object") continue;
    const placeId = (loc as { placeId?: unknown }).placeId;
    if (typeof placeId === "string" && placeId.length > 0) ids.add(placeId);
  }
  return [...ids];
}

/** eventLocationId из MessageParsed (payload.eventLocationIds или locations[].id). */
export function extractEventLocationIdsFromParsedPayload(
  payload: Record<string, unknown>,
): string[] {
  const fromPayload = payload.eventLocationIds;
  if (Array.isArray(fromPayload)) {
    return fromPayload.map(String).filter((id) => id.length > 0);
  }
  const locations = payload.locations;
  if (!Array.isArray(locations)) return [];
  const ids = new Set<string>();
  for (const loc of locations) {
    if (!loc || typeof loc !== "object") continue;
    const id = (loc as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  return [...ids];
}