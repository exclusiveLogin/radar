/**
 * TypeORM `DataSource.query` для INSERT/UPDATE … RETURNING отдаёт `[rows, rowCount]`,
 * для SELECT — плоский массив строк. Нормализуем к `T[]`.
 */
export function readTypeOrmQueryRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    (typeof result[1] === "number" || result[1] === null)
  ) {
    return result[0] as T[];
  }
  return result as T[];
}

/** timestamptz → ISO; битые/null → fallback (now). */
export function pgTimestampToIso(value: unknown): string {
  const iso = pgTimestampToIsoOptional(value);
  return iso ?? new Date().toISOString();
}

/** null / Invalid Date → undefined (не подставлять epoch для processed_at). */
export function pgTimestampToIsoOptional(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
