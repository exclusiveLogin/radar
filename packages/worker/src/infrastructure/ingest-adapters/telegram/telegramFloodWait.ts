/**
 * Извлекает секунды ожидания из FloodWait (GramJS RPCError).
 */
/** Верхняя граница FloodWait от Telegram (сек); защита от мусорных значений. */
const MAX_FLOOD_WAIT_SEC = 3600;

export function getFloodWaitSeconds(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { errorMessage?: string; seconds?: number };
  if (typeof e.seconds === "number" && e.seconds > 0) {
    return Math.min(e.seconds, MAX_FLOOD_WAIT_SEC);
  }
  const message = e.errorMessage ?? "";
  if (message.startsWith("FLOOD_WAIT_")) {
    const parsed = Number(message.replace("FLOOD_WAIT_", ""));
    if (!Number.isFinite(parsed) || parsed <= 0) return 30;
    return Math.min(parsed, MAX_FLOOD_WAIT_SEC);
  }
  return null;
}

/** Безопасный sleep: teleproto RequestIter при waitTime+lastLoad=0 даёт отрицательный delay. */
export function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  const safeMs = Math.min(ms, MAX_FLOOD_WAIT_SEC * 1000);
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}
