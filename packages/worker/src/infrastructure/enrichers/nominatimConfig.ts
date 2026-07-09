/** Пауза между запросами к публичному Nominatim (политика OSM ~1 req/s). */
export const NOMINATIM_DEFAULT_MIN_INTERVAL_MS = 1100;
/** Стартовая пауза после HTTP 429 (без Retry-After). */
export const NOMINATIM_DEFAULT_429_BACKOFF_MS = 15_000;
export const NOMINATIM_DEFAULT_429_MAX_BACKOFF_MS = 120_000;
export const NOMINATIM_DEFAULT_429_MAX_RETRIES = 4;

import { loadGeoEnrichersManifest } from "@radar/shared/manifest/domains/geoEnrichers.loader.js";
import { MONOREPO_ROOT } from "@repo/root";

function geoNominatim() {
  return loadGeoEnrichersManifest({ repoRoot: MONOREPO_ROOT }).nominatim;
}

export function loadNominatimMinIntervalMs(_env: NodeJS.ProcessEnv = process.env): number {
  return geoNominatim().minIntervalMs;
}

export function loadNominatim429BackoffMs(_env: NodeJS.ProcessEnv = process.env): number {
  return geoNominatim().backoffMs;
}

export function loadNominatim429MaxBackoffMs(_env: NodeJS.ProcessEnv = process.env): number {
  return geoNominatim().maxBackoffMs;
}

export function loadNominatim429MaxRetries(_env: NodeJS.ProcessEnv = process.env): number {
  return geoNominatim().maxRetries;
}

/** User-Agent обязателен для nominatim.openstreetmap.org. */
export function loadNominatimUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const fromManifest = geoNominatim().userAgent?.trim();
  if (fromManifest) return fromManifest;
  const ua = env.RADAR_NOMINATIM_USER_AGENT?.trim();
  return ua || "radar-worker/0.1 (geo-parse; contact: local-dev)";
}
