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
