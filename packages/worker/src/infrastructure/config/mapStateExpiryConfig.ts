import { resolveMapStateTtlMs as resolveMapStateTtlMsShared } from "@radar/shared";

export { DEFAULT_MAP_STATE_TTL_MS } from "@radar/shared";

const DEFAULT_POLL_MS = 5 * 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Длительность удержания статуса до сброса (мс). */
export function resolveMapStateTtlMs(): number {
  return resolveMapStateTtlMsShared(process.env);
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
