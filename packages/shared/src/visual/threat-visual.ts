import type { EventSubject } from "../schemas/ingest/event-type";
import type { StateLevel } from "../schemas/geo/state-level";

/** Ортогональные traits победителя fold (PE 2.0). */
export type ThreatTraits = {
  mass?: boolean;
  uncertain?: boolean;
};

export type ThreatVisualKey =
  | "rocket"
  | "uav_danger"
  | "uav_mass"
  | "pvo"
  | "intercept"
  | "fixation";

/** Коды статуса, для которых рисуем иконку на карте. */
export const THREAT_MAP_STATUS_CODES = [
  "rocket_threat",
  "warning",
  "danger",
  "pvo_work",
  "fixation",
  "intercept",
] as const;

export type ThreatMapStatusCode = (typeof THREAT_MAP_STATUS_CODES)[number];

/** Окно критической панели (совпадает с REGION_CALM_STALE_MS на фронте). */
export const CRITICAL_WINDOW_MS = 3 * 60 * 60 * 1000;

const THREAT_GLYPH: Record<ThreatVisualKey, string> = {
  rocket: "▲",
  uav_danger: "✦",
  uav_mass: "✦×",
  pvo: "◎",
  intercept: "⊘",
  fixation: "◉",
};

/** Латиница для MapLibre symbol (Noto Sans Regular — без спецсимволов). */
const THREAT_MAP_GLYPH: Record<ThreatVisualKey, string> = {
  rocket: "R",
  uav_danger: "U",
  uav_mass: "M",
  pvo: "P",
  intercept: "X",
  fixation: "F",
};

const ALARM_STATE_LEVELS = new Set<StateLevel>(["red", "orange", "yellow"]);

const THREAT_ACCENT: Record<ThreatVisualKey, string> = {
  rocket: "#d93535",
  uav_danger: "#d93535",
  uav_mass: "#d93535",
  pvo: "#6aacca",
  intercept: "#d93535",
  fixation: "#d9680a",
};

export type ThreatVisual = {
  key: ThreatVisualKey;
  glyph: string;
  /** Глиф для MapLibre text-field (базовая латиница). */
  mapGlyph: string;
  accentColor: string;
  showOnMap: boolean;
  showInTopBar: boolean;
  dimmed: boolean;
};

export type ResolveThreatVisualInput = {
  statusCode?: string;
  traits?: ThreatTraits;
  eventSubject?: EventSubject | string;
};

/** Критическая угроза для верхней панели: ракета или warning+mass. */
export function isCriticalTopBarThreat(input: ResolveThreatVisualInput): boolean {
  if (input.statusCode === "rocket_threat") return true;
  if (input.statusCode === "warning" && input.traits?.mass === true) return true;
  return false;
}

/** Активность в окне 3ч относительно якоря просмотра. */
export function isWithinCriticalWindow(
  statusEventAt: string | undefined,
  viewNowMs: number,
): boolean {
  if (!statusEventAt) return false;
  const eventMs = Date.parse(statusEventAt);
  if (!Number.isFinite(eventMs)) return false;
  return viewNowMs - eventMs < CRITICAL_WINDOW_MS;
}

/** Ключ иконки по statusCode + traits + eventSubject. */
export function resolveThreatVisualKey(
  input: ResolveThreatVisualInput,
): ThreatVisualKey | null {
  const code = input.statusCode;
  if (!code) return null;
  if (!THREAT_MAP_STATUS_CODES.includes(code as ThreatMapStatusCode)) return null;

  if (code === "rocket_threat") return "rocket";
  if (code === "pvo_work") return "pvo";
  if (code === "intercept") return "intercept";
  if (code === "fixation") return "fixation";
  if (code === "warning" && input.traits?.mass) return "uav_mass";
  if (code === "danger" || code === "warning") {
    if (input.eventSubject === "rocket") return "rocket";
    return "uav_danger";
  }

  return null;
}

/** SSOT визуала угрозы для карты, панелей и тултипов. */
export function resolveThreatVisual(input: ResolveThreatVisualInput): ThreatVisual | null {
  const key = resolveThreatVisualKey(input);
  if (!key) return null;

  return {
    key,
    glyph: THREAT_GLYPH[key],
    mapGlyph: THREAT_MAP_GLYPH[key],
    accentColor: THREAT_ACCENT[key],
    showOnMap: true,
    showInTopBar: isCriticalTopBarThreat(input),
    dimmed: input.traits?.uncertain === true,
  };
}

/**
 * Маркер угрозы на карте: только alarm-уровень (не grey/green) и threat statusCode.
 * Grey/green могут нести устаревший statusCode из WS — не рисуем.
 */
export function shouldShowRegionThreatMarker(
  input: ResolveThreatVisualInput & { stateLevel: StateLevel },
): boolean {
  if (!ALARM_STATE_LEVELS.has(input.stateLevel)) return false;
  return resolveThreatVisual(input) !== null;
}

/** Статус-код показываем на карте? */
export function isThreatMapStatusCode(statusCode?: string): boolean {
  if (!statusCode) return false;
  return THREAT_MAP_STATUS_CODES.includes(statusCode as ThreatMapStatusCode);
}
