/** Токен DaData из env; без него шаг dadata no-op (пайплайн не падает). */
import { loadGeoEnrichersManifest } from "@radar/shared/manifest/domains/geoEnrichers.loader.js";
import { MONOREPO_ROOT } from "@repo/root";

/** DaData enabled из geo.enrichers.manifest.json (+ GEO__ overlay). */
export function isDadataEnabled(): boolean {
  return loadGeoEnrichersManifest({ repoRoot: MONOREPO_ROOT }).dadata.enabled;
}

export function loadDadataToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.DADATA_TOKEN?.trim();
  return token || undefined;
}

/** enabled в manifest + токен в env. */
export function isDadataConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDadataEnabled() && Boolean(loadDadataToken(env));
}
