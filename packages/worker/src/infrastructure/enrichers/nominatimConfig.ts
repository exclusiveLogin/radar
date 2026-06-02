/** Пауза между запросами к публичному Nominatim (политика OSM ~1 req/s). */
export const NOMINATIM_DEFAULT_MIN_INTERVAL_MS = 1100;
/** Стартовая пауза после HTTP 429 (без Retry-After). */
export const NOMINATIM_DEFAULT_429_BACKOFF_MS = 15_000;
export const NOMINATIM_DEFAULT_429_MAX_BACKOFF_MS = 120_000;
export const NOMINATIM_DEFAULT_429_MAX_RETRIES = 4;

export function loadNominatimMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_NOMINATIM_MIN_INTERVAL_MS;
  if (raw === undefined || raw === "") return NOMINATIM_DEFAULT_MIN_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NOMINATIM_DEFAULT_MIN_INTERVAL_MS;
  return parsed;
}

export function loadNominatim429BackoffMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_NOMINATIM_429_BACKOFF_MS;
  if (raw === undefined || raw === "") return NOMINATIM_DEFAULT_429_BACKOFF_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NOMINATIM_DEFAULT_429_BACKOFF_MS;
  return parsed;
}

export function loadNominatim429MaxBackoffMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_NOMINATIM_429_MAX_BACKOFF_MS;
  if (raw === undefined || raw === "") return NOMINATIM_DEFAULT_429_MAX_BACKOFF_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NOMINATIM_DEFAULT_429_MAX_BACKOFF_MS;
  return parsed;
}

export function loadNominatim429MaxRetries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_NOMINATIM_429_MAX_RETRIES;
  if (raw === undefined || raw === "") return NOMINATIM_DEFAULT_429_MAX_RETRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NOMINATIM_DEFAULT_429_MAX_RETRIES;
  return Math.floor(parsed);
}

/** User-Agent обязателен для nominatim.openstreetmap.org. */
export function loadNominatimUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const ua = env.RADAR_NOMINATIM_USER_AGENT?.trim();
  return ua || "radar-worker/0.1 (geo-parse; contact: local-dev)";
}
