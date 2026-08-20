import type { ILocationEnricher } from "@radar/shared";
import { loadGeoEnrichersManifest, type GeoEnrichersManifest } from "@radar/shared/manifest/domains/geoEnrichers.loader.js";
import { MONOREPO_ROOT } from "@repo/root";
import { CompositeEnricher } from "./compositeEnricher.js";
import { loadLlmRuntimeConfig } from "./llmRuntimeConfig.js";

export type ResolvedEnricherFlags = {
  dadata: boolean;
  nominatim: boolean;
  llm: boolean;
};

let cachedGeoManifest: GeoEnrichersManifest | undefined;

/** SSOT: geo.enrichers.manifest.json (+ GEO__ env). */
export function resolveGeoEnrichersManifest(): GeoEnrichersManifest {
  cachedGeoManifest ??= loadGeoEnrichersManifest({ repoRoot: MONOREPO_ROOT });
  return cachedGeoManifest;
}

/** Флаги enricher-цепочки из manifest. */
export function resolveEnricherFlags(manifest = resolveGeoEnrichersManifest()): ResolvedEnricherFlags {
  const llmConfig = loadLlmRuntimeConfig(manifest);
  return {
    dadata: manifest.dadata.enabled,
    nominatim: manifest.nominatim.enabled,
    llm: llmConfig.enabled,
  };
}

/** @deprecated Используй resolveEnricherFlags(). */
export function resolveEnricherFlagsFromEnv(env = process.env): ResolvedEnricherFlags {
  void env;
  return resolveEnricherFlags();
}
// ─── Pipeline order ───────────────────────────────────────────────────────

export type PipelineStepId = "catalog" | "llm" | "dadata" | "nominatim";
const pipelineStepIdSet = new Set<PipelineStepId>([
  "catalog",
  "llm",
  "dadata",
  "nominatim",
]);

/**
 * Default execution order. `catalog` is cheap and feeds regionCode into later steps.
 * `FinalizerStep` is always appended last by the runner — not listed here.
 */
/** catalog → dadata (coords) → llm (семантика) → nominatim; finalizer: dadata coords поверх llm. */
export const DEFAULT_PIPELINE_ORDER: PipelineStepId[] = [
  "catalog",
  "dadata",
  "llm",
  "nominatim",
];

/**
 * Parses `RADAR_GEO_PIPELINE_ORDER=catalog,llm,dadata,nominatim` env var.
 * Unknown tokens are silently dropped.
 */
export function resolvePipelineOrderFromEnv(env = process.env): PipelineStepId[] | undefined {
  const manifestOrder = resolveGeoEnrichersManifest().pipeline.order;
  if (manifestOrder?.length) return manifestOrder;
  const raw = env.RADAR_GEO_PIPELINE_ORDER;
  if (!raw?.trim()) return undefined;
  const parsed = raw
    .split(",")
    .map((step) => step.trim().toLowerCase() as PipelineStepId)
    .filter((step) => pipelineStepIdSet.has(step));
  return parsed.length > 0 ? parsed : undefined;
}

// ─── Legacy composite (kept for backwards compat) ─────────────────────────

export { CompositeEnricher } from "./compositeEnricher.js";

export function wrapEnricherFallback(chain: ILocationEnricher[]): ILocationEnricher {
  return new CompositeEnricher(chain);
}

