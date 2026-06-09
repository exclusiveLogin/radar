/**
 * Глобальная serial-очередь внешних геокодеров (DaData + Nominatim).
 * Параллельные HTTP к разным провайдерам дают 429 у Nominatim — один gate на процесс.
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

/** Дождаться слота перед следующим HTTP к DaData или Nominatim. */
export async function waitExternalGeocoderSlot(minIntervalMs: number): Promise<void> {
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

/** @deprecated используйте waitExternalGeocoderSlot */
export const waitNominatimSlot = waitExternalGeocoderSlot;

/** Только для тестов. */
export function resetExternalGeocoderSerialForTests(): void {
  gate = Promise.resolve();
  lastRequestAtMs = 0;
  cooldownUntilMs = 0;
}

/** @deprecated используйте resetExternalGeocoderSerialForTests */
export const resetNominatimRateLimitForTests = resetExternalGeocoderSerialForTests;
