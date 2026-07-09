import {
  DEFAULT_GEO_ENRICHERS_MANIFEST,
  geoEnrichersManifestSchema,
  type GeoEnrichersManifest,
} from "./geoEnrichers.schema.js";
import { loadDomainManifest } from "../loadDomainManifest.js";

export type LoadGeoEnrichersManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

/** Загрузка geo.enrichers.manifest.json + GEO__ env overlay. */
export function loadGeoEnrichersManifest(
  options: LoadGeoEnrichersManifestOptions,
): GeoEnrichersManifest {
  return loadDomainManifest<GeoEnrichersManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "geo.enrichers",
    envPrefix: "GEO",
    schema: geoEnrichersManifestSchema,
    defaults: DEFAULT_GEO_ENRICHERS_MANIFEST,
  });
}

export type { GeoEnrichersManifest } from "./geoEnrichers.schema.js";
