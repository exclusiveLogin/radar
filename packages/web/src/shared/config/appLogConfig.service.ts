import type { AppLogLevel } from "../state/appLogStore";

/** Минимальный уровень для UI-ленты и console appLog (VITE_APP_LOG_LEVEL). */
export type AppLogMinLevel = AppLogLevel;

const LEVEL_RANK: Record<AppLogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
};

const DEFAULT_MIN_LEVEL: AppLogMinLevel = "warn";

/** Нормализует значение env (`warning` → `warn`). */
export function parseAppLogMinLevel(raw: string | undefined): AppLogMinLevel {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return DEFAULT_MIN_LEVEL;
  if (normalized === "warning") return "warn";
  if (normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return DEFAULT_MIN_LEVEL;
}

/** SSOT: порог видимости из VITE_APP_LOG_LEVEL (default: warn). */
export function resolveAppLogMinLevel(): AppLogMinLevel {
  return parseAppLogMinLevel(import.meta.env.VITE_APP_LOG_LEVEL);
}

/** true — сообщение проходит в ленту при текущем пороге. */
export function isAppLogLevelEnabled(
  level: AppLogLevel,
  minLevel: AppLogMinLevel = resolveAppLogMinLevel(),
): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}
