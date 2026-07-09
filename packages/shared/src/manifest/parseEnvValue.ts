/**
 * Явный парсинг env-значений для manifest overlay.
 * true/false/yes/no/on/off — boolean; чистые числа — number; иначе string.
 */
export function parseEnvValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "on") return true;
  if (lower === "false" || lower === "no" || lower === "off") return false;
  const num = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(num) && String(num) === trimmed) return num;
  return trimmed;
}
