/**
 * Извлекает секунды ожидания из FloodWait (GramJS RPCError).
 */
export function getFloodWaitSeconds(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { errorMessage?: string; seconds?: number };
  if (typeof e.seconds === "number" && e.seconds > 0) {
    return e.seconds;
  }
  const message = e.errorMessage ?? "";
  if (message.startsWith("FLOOD_WAIT_")) {
    const parsed = Number(message.replace("FLOOD_WAIT_", ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
