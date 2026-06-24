/**
 * Негативный мониторинг канала: «фиксаций нет», «не наблюдаем», FAQ-отрицание угрозы.
 * SSOT для negative-monitoring-processor и finalize gate.
 */
const NEGATIVE_MONITORING_PATTERNS = [
  /не\s+наблюдаем/i,
  /фиксаци[а-яё]*\s+нет/i,
  /фиксаций\s+нет/i,
  /почти\s+нет/i,
  /ожидаем\s+отбо/i,
  /воздушных\s+целей.*не\s+наблюдаем/is,
  /не\s+нужно\s+посылать\s+обратную\s+связь/i,
  /никакой\s+угрозы\s+нет/i,
  /отбой\s+не\s+объявляли/i,
];

/** Текст — статус «всё тихо» / мониторинг без оперативного сигнала. */
export function extractNegativeMonitoringFlag(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  return NEGATIVE_MONITORING_PATTERNS.some((pattern) => pattern.test(text));
}
