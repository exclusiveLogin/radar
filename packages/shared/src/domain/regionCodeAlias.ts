/**
 * Нормализация legacy/alias кодов субъектов к каноническому ISO.
 * Используется на ingest/parse границе до резолва region_id.
 */
const REGION_ALIAS_TO_CANONICAL: Record<string, string> = {
  "UA-43": "RU-CR",
  "RU-SE": "RU-SEV",
};

export function normalizeRegionCodeAlias(code: string): string {
  const raw = code.trim().toUpperCase();
  if (!raw) {
    return raw;
  }
  return REGION_ALIAS_TO_CANONICAL[raw] ?? raw;
}
