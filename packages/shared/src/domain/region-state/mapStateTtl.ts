/** TTL операционного статуса на карте: по умолчанию 24 часа. */
export const DEFAULT_MAP_STATE_TTL_MS = 24 * 60 * 60 * 1000;

/** Окно скрытия green/grey на карте после отбоя (совпадает с map-query). */
export const REGION_CALM_SUPPRESS_MS = 3 * 60 * 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
