import { parseEnvValue } from "./parseEnvValue.js";
import type { ManifestArrayKeys } from "./manifestTypes.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Устанавливает значение по пути сегментов; arrayKeys — keyed merge для массивов. */
function setByPath(
  root: Record<string, unknown>,
  segments: string[],
  value: unknown,
  arrayKeys: ManifestArrayKeys,
  path = "",
): void {
  if (segments.length === 0) return;

  const [head, ...rest] = segments;
  if (!head) return;

  const childPath = path ? `${path}.${head}` : head;
  const keyField = arrayKeys[childPath];

  if (rest.length === 0) {
    root[head] = value;
    return;
  }

  if (keyField) {
    const keyValue = rest[0]!;
    const fieldSegments = rest.slice(1);
    const arrRaw = root[head];
    const items = (Array.isArray(arrRaw) ? [...arrRaw] : []) as Record<string, unknown>[];
    let idx = items.findIndex((item) => isPlainObject(item) && item[keyField] === keyValue);
    if (idx < 0) {
      items.push({ [keyField]: keyValue });
      idx = items.length - 1;
    }
    const item = { ...(items[idx] as Record<string, unknown>) };
    if (fieldSegments.length === 0) {
      items[idx] = { ...item, [keyField]: keyValue };
    } else {
      setByPath(item, fieldSegments, value, arrayKeys, `${childPath}[${keyValue}]`);
      items[idx] = item;
    }
    root[head] = items;
    return;
  }

  let child = root[head];
  if (!isPlainObject(child)) {
    child = {};
    root[head] = child;
  }
  setByPath(child as Record<string, unknown>, rest, value, arrayKeys, childPath);
}

function deepMergeOverlay(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  arrayKeys: ManifestArrayKeys,
  path = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const childPath = path ? `${path}.${key}` : key;
    const baseValue = result[key];

    if (Array.isArray(patchValue)) {
      const keyField = arrayKeys[childPath];
      if (keyField && Array.isArray(baseValue)) {
        const byKey = new Map<string, Record<string, unknown>>();
        for (const item of baseValue) {
          if (!isPlainObject(item)) continue;
          const k = item[keyField];
          if (typeof k === "string") byKey.set(k, { ...item });
        }
        for (const item of patchValue) {
          if (!isPlainObject(item)) continue;
          const k = item[keyField];
          if (typeof k !== "string") continue;
          byKey.set(k, deepMergeOverlay(byKey.get(k) ?? { [keyField]: k }, item, arrayKeys, childPath));
        }
        result[key] = [...byKey.values()];
      } else {
        result[key] = patchValue;
      }
      continue;
    }

    if (isPlainObject(patchValue) && isPlainObject(baseValue)) {
      result[key] = deepMergeOverlay(baseValue, patchValue, arrayKeys, childPath);
      continue;
    }

    result[key] = patchValue;
  }
  return result;
}

/**
 * Патчит manifest значениями env формата PREFIX__seg__seg=value.
 */
export function applyEnvOverlay<T>(
  manifest: T,
  envPrefix: string,
  env: NodeJS.ProcessEnv,
  arrayKeys: ManifestArrayKeys = {},
): T {
  const base = manifest as Record<string, unknown>;
  const prefix = `${envPrefix}__`;
  const patch: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith(prefix) || raw == null) continue;
    const segments = key.slice(prefix.length).split("__").filter(Boolean);
    if (segments.length === 0) continue;
    try {
      setByPath(patch, segments, parseEnvValue(raw), arrayKeys);
    } catch (err) {
      console.warn(`[manifest] ignore env ${key}:`, err);
    }
  }

  if (Object.keys(patch).length === 0) return manifest;
  return deepMergeOverlay(base, patch, arrayKeys) as T;
}
