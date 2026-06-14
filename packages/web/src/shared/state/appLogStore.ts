import { BehaviorSubject } from "rxjs";

import {
  isAppLogLevelEnabled,
  resolveAppLogMinLevel,
  type AppLogMinLevel,
} from "../config/appLogConfig.service";

export type AppLogLevel = "info" | "warn" | "error";

export type AppLogEntry = {
  id: string;
  level: AppLogLevel;
  /** Источник: «Карта», «Сообщения», … */
  source?: string;
  message: string;
  at: number;
};

/** Колцевой буфер: не более N последних сообщений (новые сверху). */
const MAX_ENTRIES = 30;
/** Автоудаление записи, если не вытеснена буфером раньше. */
const TTL_MS = 60_000;
/** Не дублировать одно и то же сообщение от источника чаще интервала (poll-ошибки). */
const DEDUP_MS = 15_000;

/** Единая лента UI — подписывается AppLogOverlay. */
export const appLogEntries$ = new BehaviorSubject<AppLogEntry[]>([]);

const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let lastDedupKey: string | null = null;
let lastDedupAt = 0;

/** Текст ошибки для UI и console. */
export function formatAppError(error: unknown, fallback = "Неизвестная ошибка"): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function formatLogLine(source: string | undefined, message: string): string {
  return source ? `${source}: ${message}` : message;
}

function cancelExpiryTimer(id: string): void {
  const timer = expiryTimers.get(id);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(id);
}

/** Снять таймеры у записей, вытесненных из буфера. */
function cancelTimersForEvicted(next: AppLogEntry[]): void {
  const nextIds = new Set(next.map((row) => row.id));
  for (const id of expiryTimers.keys()) {
    if (!nextIds.has(id)) cancelExpiryTimer(id);
  }
}

function shouldSkipDuplicate(source: string | undefined, message: string): boolean {
  const key = `${source ?? ""}\0${message}`;
  const now = Date.now();
  if (key === lastDedupKey && now - lastDedupAt < DEDUP_MS) return true;
  lastDedupKey = key;
  lastDedupAt = now;
  return false;
}

function logToConsole(level: AppLogLevel, line: string, error?: unknown): void {
  if (level === "error") {
    if (error !== undefined) console.error(`[appLog] ${line}`, error);
    else console.error(`[appLog] ${line}`);
    return;
  }
  if (level === "warn") console.warn(`[appLog] ${line}`);
  if (level === "info") console.info(`[appLog] ${line}`);
}

/** Текущий порог (env VITE_APP_LOG_LEVEL, default warn). */
export function getAppLogMinLevel(): AppLogMinLevel {
  return resolveAppLogMinLevel();
}

export type PushAppLogOptions = {
  source?: string;
  /** Не писать в console (UI-only). */
  silentConsole?: boolean;
  /** Не подавлять повтор тем же текстом в DEDUP_MS. */
  allowDuplicate?: boolean;
};

/**
 * Центральная точка: событие или ошибка в ленту UI.
 * Используйте reportAppError для catch-блоков.
 */
export function pushAppLog(
  level: AppLogLevel,
  message: string,
  options?: PushAppLogOptions,
): void {
  const source = options?.source?.trim() || undefined;
  const text = message.trim();
  if (!text) return;
  if (!isAppLogLevelEnabled(level)) return;
  if (!options?.allowDuplicate && shouldSkipDuplicate(source, text)) return;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: AppLogEntry = { id, level, source, message: text, at: Date.now() };
  const next = [entry, ...appLogEntries$.value].slice(0, MAX_ENTRIES);
  cancelTimersForEvicted(next);
  appLogEntries$.next(next);

  if (!options?.silentConsole) {
    logToConsole(level, formatLogLine(source, text));
  }

  cancelExpiryTimer(id);
  expiryTimers.set(
    id,
    setTimeout(() => {
      appLogEntries$.next(appLogEntries$.value.filter((row) => row.id !== id));
      expiryTimers.delete(id);
    }, TTL_MS),
  );
}

/** Ошибка из catch: UI + console с исходным объектом. */
export function reportAppError(
  source: string,
  error: unknown,
  fallback = "Ошибка",
): void {
  const message = formatAppError(error, fallback);
  pushAppLog("error", message, { source, silentConsole: true });
  console.error(`[${source}]`, error);
}

export function clearAppLogs(): void {
  for (const id of [...expiryTimers.keys()]) cancelExpiryTimer(id);
  appLogEntries$.next([]);
  lastDedupKey = null;
  lastDedupAt = 0;
}
