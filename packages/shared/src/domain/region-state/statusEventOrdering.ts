/** Событие старше окна TTL карты — не меняем проекцию (reparse не воскрешает отбой). */
export function isMapEventOlderThanTtl(
  eventAtIso: string,
  referenceMs: number,
  ttlMs: number,
): boolean {
  if (ttlMs <= 0) return false;
  const eventMs = Date.parse(eventAtIso);
  if (!Number.isFinite(eventMs)) return false;
  return referenceMs - eventMs > ttlMs;
}

/** postedAt последнего принятого события, выставившего текущий статус. */
export function isStaleStatusEvent(
  incomingEventAt: string,
  statusEventAt: string | undefined | null,
): boolean {
  if (!statusEventAt) return false;
  const incomingMs = Date.parse(incomingEventAt);
  const statusMs = Date.parse(statusEventAt);
  if (!Number.isFinite(incomingMs) || !Number.isFinite(statusMs)) return false;
  return incomingMs < statusMs;
}

export const PLACE_STATUS_EVENT_AT_META_KEY = "statusEventAt";

export function readPlaceStatusEventAt(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const value = meta?.[PLACE_STATUS_EVENT_AT_META_KEY];
  return typeof value === "string" ? value : undefined;
}

/** Последнее действие winner региона/места в fold. */
export type MapStatusAction = "raise" | "clear";

/**
 * Place скрывают с карты только при более свежем региональном clear (не raise).
 * Строго >: в одном сообщении region+place с одним postedAt place не гасится.
 */
export function isPlaceSuppressedByRegionClear(input: {
  placeStatusEventAt?: string;
  regionStatusEventAt?: string;
  regionAction?: MapStatusAction;
}): boolean {
  if (input.regionAction !== "clear") return false;
  if (!input.regionStatusEventAt || !input.placeStatusEventAt) return false;
  return input.regionStatusEventAt > input.placeStatusEventAt;
}
