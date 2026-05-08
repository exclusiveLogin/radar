import type { ILocationEnricher } from "@radar/shared";
import { CompositeEnricher } from "./compositeEnricher.js";
import { DadataEnricher } from "./dadataEnricher.js";
import { LlmEnricher } from "./llmEnricher.js";
import { NominatimEnricher } from "./nominatimEnricher.js";
import { loadLlmRuntimeConfig, type LlmRuntimeConfig } from "./llmRuntimeConfig.js";

const truthy = new Set(["1", "true", "yes", "on"]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return truthy.has(value.trim().toLowerCase());
}

export type ResolvedEnricherFlags = {
  dadata: boolean;
  nominatim: boolean;
  llm: boolean;
};

/** Флаги из env; LLM включается только когда `RADAR_LLM_GEOCODER_ENABLED` truthy—см. `loadLlmRuntimeConfig`. */
export function resolveEnricherFlagsFromEnv(env = process.env): ResolvedEnricherFlags {
  const llmConfig = loadLlmRuntimeConfig(env);
  return {
    dadata: parseBoolean(env.RADAR_ENRICHER_DADATA_ENABLED, true),
    nominatim: parseBoolean(env.RADAR_ENRICHER_NOMINATIM_ENABLED, true),
    llm: llmConfig.enabled,
  };
}

/** Собирает список enrichers в порядке fallback (DaData → Nominatim → LLM). */
export function buildEnricherChain(
  flags: ResolvedEnricherFlags,
  llmRuntimeConfig: LlmRuntimeConfig,
  dadataToken?: string,
): ILocationEnricher[] {
  const chain: ILocationEnricher[] = [];
  if (flags.dadata) chain.push(new DadataEnricher(dadataToken));
  if (flags.nominatim) chain.push(new NominatimEnricher());
  if (flags.llm) chain.push(new LlmEnricher(llmRuntimeConfig));
  return chain;
}

export function wrapEnricherFallback(chain: ILocationEnricher[]): ILocationEnricher {
  return new CompositeEnricher(chain);
}
