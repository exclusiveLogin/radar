import type { ILocationEnricher } from "@radar/shared";
import { CompositeEnricher } from "./compositeEnricher.js";
import { loadLlmRuntimeConfig } from "./llmRuntimeConfig.js";

const truthy = new Set(["1", "true", "yes", "on"]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return truthy.has(value.trim().toLowerCase());
}

// ─── Enricher flags ───────────────────────────────────────────────────────

export type ResolvedEnricherFlags = {
  dadata: boolean;
  nominatim: boolean;
  llm: boolean;
};

/** Флаги из env; LLM включается только когда `RADAR_LLM_GEOCODER_ENABLED` truthy. */
export function resolveEnricherFlagsFromEnv(env = process.env): ResolvedEnricherFlags {
  const llmConfig = loadLlmRuntimeConfig(env);
  return {
    dadata: parseBoolean(env.RADAR_ENRICHER_DADATA_ENABLED, true),
    nominatim: parseBoolean(env.RADAR_ENRICHER_NOMINATIM_ENABLED, true),
    llm: llmConfig.enabled,
  };
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
export const DEFAULT_PIPELINE_ORDER: PipelineStepId[] = [
  "catalog",
  "llm",
  "dadata",
  "nominatim",
];

/**
 * Parses `RADAR_GEO_PIPELINE_ORDER=catalog,llm,dadata,nominatim` env var.
 * Unknown tokens are silently dropped.
 */
export function resolvePipelineOrderFromEnv(env = process.env): PipelineStepId[] | undefined {
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

