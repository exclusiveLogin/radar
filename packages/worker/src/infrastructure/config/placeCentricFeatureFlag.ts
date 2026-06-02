function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Включает place-centric контур: append-only event_evidence при parse (geo-очередь — отдельно, geoParse).
 * По умолчанию включено.
 */
export function isPlaceCentricGeoEnabled(): boolean {
  return parseBoolean(process.env.PLACE_CENTRIC_GEO_ENABLED, true);
}
