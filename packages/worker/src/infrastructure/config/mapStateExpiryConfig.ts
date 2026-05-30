/** TTL операционного статуса на карте: по умолчанию 24 часа. */
export const DEFAULT_MAP_STATE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_POLL_MS = 5 * 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Длительность удержания статуса до сброса (мс). */
export function resolveMapStateTtlMs(): number {
  const hours = process.env.RADAR_MAP_STATE_TTL_HOURS?.trim();
  if (hours) {
    const h = Number(hours);
    if (Number.isFinite(h) && h > 0) return h * 60 * 60 * 1000;
  }
  return parsePositiveInt(process.env.RADAR_MAP_STATE_TTL_MS, DEFAULT_MAP_STATE_TTL_MS);
}

/** Период фонового sweep (мс). */
export function resolveMapStateExpiryPollMs(): number {
  return parsePositiveInt(
    process.env.RADAR_MAP_STATE_EXPIRY_POLL_MS,
    DEFAULT_POLL_MS,
  );
}

/** Включён ли демон TTL (в db mode по умолчанию да). */
export function isMapStateExpiryEnabled(): boolean {
  const flag = process.env.RADAR_MAP_STATE_EXPIRY_ENABLED?.trim();
  if (flag === "0" || flag === "false") return false;
  return true;
}
