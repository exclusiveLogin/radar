/**
 * LLM иногда возвращает confidence как 1–5 или целое >1.
 * Контракт продукта — число в [0, 1].
 */
export function normalizeLlmConfidence(value: unknown): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(raw)) return 0;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 5) return raw / 5;
  return 1;
}
