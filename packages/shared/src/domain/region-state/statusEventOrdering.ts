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
