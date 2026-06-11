/** TTL операционного статуса на карте: по умолчанию 24 часа. */
export const DEFAULT_MAP_STATE_TTL_MS = 24 * 60 * 60 * 1000;

/** Окно скрытия green/grey на карте после отбоя (совпадает с map-query). */
export const REGION_CALM_SUPPRESS_MS = 3 * 60 * 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Источник live read-line карты: fold фактов или materialized read_model. */
export type MapReadSource = "fold" | "read_model";

/** Live snapshot/WS: fold (default после фазы 2b) или legacy read_model. */
export function resolveMapReadSource(env: NodeJS.ProcessEnv = process.env): MapReadSource {
  const raw = env.RADAR_MAP_READ_SOURCE?.trim().toLowerCase();
  if (raw === "read_model") return "read_model";
  return "fold";
}

/** Длительность удержания статуса на карте (мс). SSOT для worker и API fold. */
export function resolveMapStateTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = env.RADAR_MAP_STATE_TTL_HOURS?.trim();
  if (hours) {
    const h = Number(hours);
    if (Number.isFinite(h) && h > 0) return h * 60 * 60 * 1000;
  }
  return parsePositiveInt(env.RADAR_MAP_STATE_TTL_MS, DEFAULT_MAP_STATE_TTL_MS);
}
