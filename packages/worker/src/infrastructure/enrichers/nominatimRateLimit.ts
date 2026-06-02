/**
 * Глобальный throttle для Nominatim: serial queue + min interval между HTTP.
 * Один процесс worker — один лимитер (manual drain и daemon делят очередь).
 */
let gate: Promise<void> = Promise.resolve();
let lastRequestAtMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Дождаться слота перед следующим запросом к Nominatim. */
export async function waitNominatimSlot(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;

  const ticket = gate.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, lastRequestAtMs + minIntervalMs - now);
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAtMs = Date.now();
  });

  gate = ticket.catch(() => undefined);
  await ticket;
}

/** Только для тестов. */
export function resetNominatimRateLimitForTests(): void {
  gate = Promise.resolve();
  lastRequestAtMs = 0;
}
