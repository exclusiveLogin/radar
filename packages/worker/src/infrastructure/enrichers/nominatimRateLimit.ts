/**
 * Глобальный throttle для Nominatim: serial queue + min interval между HTTP.
 * Один процесс worker — один лимитер (manual drain и daemon делят очередь).
 */
let gate: Promise<void> = Promise.resolve();
let lastRequestAtMs = 0;
/** Доп. пауза после 429 — все последующие запросы ждут до этого момента. */
let cooldownUntilMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** После HTTP 429 — продлить глобальный cooldown (экспоненциальный backoff). */
export function extendNominatimCooldown(ms: number): void {
  if (ms <= 0) return;
  cooldownUntilMs = Math.max(cooldownUntilMs, Date.now() + ms);
}

/** Дождаться слота перед следующим запросом к Nominatim. */
export async function waitNominatimSlot(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;

  const ticket = gate.then(async () => {
    const now = Date.now();
    const cooldownWait = Math.max(0, cooldownUntilMs - now);
    const intervalWait = Math.max(0, lastRequestAtMs + minIntervalMs - now);
    const waitMs = Math.max(cooldownWait, intervalWait);
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
  cooldownUntilMs = 0;
}
