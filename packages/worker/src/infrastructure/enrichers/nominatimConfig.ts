/** Пауза между запросами к публичному Nominatim (политика OSM ~1 req/s). */
export const NOMINATIM_DEFAULT_MIN_INTERVAL_MS = 1100;

export function loadNominatimMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_NOMINATIM_MIN_INTERVAL_MS;
  if (raw === undefined || raw === "") return NOMINATIM_DEFAULT_MIN_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NOMINATIM_DEFAULT_MIN_INTERVAL_MS;
  return parsed;
}

/** User-Agent обязателен для nominatim.openstreetmap.org. */
export function loadNominatimUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const ua = env.RADAR_NOMINATIM_USER_AGENT?.trim();
  return ua || "radar-worker/0.1 (geo-parse; contact: local-dev)";
}
