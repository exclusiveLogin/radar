import type { ManifestArrayKeys } from "./manifestTypes.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Merge массива объектов по стабильному ключу (pipelineKey и т.п.). */
function mergeKeyedArray(
  base: unknown[],
  patch: unknown[],
  keyField: string,
): unknown[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of base) {
    if (!isPlainObject(item)) continue;
    const key = item[keyField];
    if (typeof key === "string") byKey.set(key, { ...item });
  }
  for (const item of patch) {
    if (!isPlainObject(item)) continue;
    const key = item[keyField];
    if (typeof key !== "string") continue;
    const prev = byKey.get(key) ?? {};
    byKey.set(key, deepMergeJson(prev, item, {}));
  }
  return [...byKey.values()];
}

/**
 * Deep merge JSON-объектов с поддержкой keyed-массивов.
 * Массивы без arrayKeys — patch заменяет base целиком.
 */
export function deepMergeJson(
  base: Record<string, unknown>,
  patch: unknown,
  arrayKeys: ManifestArrayKeys,
  path = "",
): Record<string, unknown> {
  if (!isPlainObject(patch)) return base;

  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const childPath = path ? `${path}.${key}` : key;
    const baseValue = result[key];

    if (Array.isArray(patchValue)) {
      const keyField = arrayKeys[childPath];
      if (keyField && Array.isArray(baseValue)) {
        result[key] = mergeKeyedArray(baseValue, patchValue, keyField);
      } else {
        result[key] = patchValue;
      }
      continue;
    }

    if (isPlainObject(patchValue) && isPlainObject(baseValue)) {
      result[key] = deepMergeJson(baseValue, patchValue, arrayKeys, childPath);
      continue;
    }

    result[key] = patchValue;
  }
  return result;
}
