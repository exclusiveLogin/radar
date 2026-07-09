import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyEnvOverlay } from "./applyEnvOverlay.js";
import { deepMergeJson } from "./deepMergeJson.js";
import type { LoadDomainManifestOptions } from "./manifestTypes.js";

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/**
 * SSOT-загрузчик доменного manifest:
 * DEFAULT → {fileBase}.manifest.json → {fileBase}.local.manifest.json → ENV overlay.
 */
export function loadDomainManifest<T>(
  options: LoadDomainManifestOptions<T>,
): T {
  const { repoRoot, fileBase, envPrefix, schema, defaults, arrayKeys = {} } = options;
  const basePath = options.baseManifestPath ?? join(repoRoot, `${fileBase}.manifest.json`);
  const localPath = join(repoRoot, `${fileBase}.local.manifest.json`);

  let merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };

  const baseRaw = readJsonFile(basePath);
  if (baseRaw && typeof baseRaw === "object") {
    merged = deepMergeJson(merged, baseRaw, arrayKeys);
  }

  const localRaw = readJsonFile(localPath);
  if (localRaw && typeof localRaw === "object") {
    merged = deepMergeJson(merged, localRaw, arrayKeys);
  }

  for (const legacy of options.legacyLocalFiles ?? []) {
    const legacyRaw = readJsonFile(join(repoRoot, legacy));
    if (legacyRaw && typeof legacyRaw === "object") {
      merged = deepMergeJson(merged, legacyRaw, arrayKeys);
    }
  }

  const withEnv = applyEnvOverlay(merged, envPrefix, options.env ?? process.env, arrayKeys);
  return schema.parse(withEnv) as T;
}
