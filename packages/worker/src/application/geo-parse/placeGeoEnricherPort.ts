import type { LocationCandidate, LocationEnrichInput } from "@radar/shared";
import type { LlmOpResult } from "../../domain/parse/geo/llmOpResult.js";

/** Порт dadata/nominatim — application без concrete infra-классов. */
export type GeoProviderEnricherPort = {
  enrich(input: LocationEnrichInput): Promise<LocationCandidate | null>;
  isSuggestionsBlocked?(): boolean;
};

export type LlmGeoEnrichPayload = {
  places?: Array<{ placeName?: string; placeFias?: string | null; confidence?: number }>;
  confidence?: number;
  model: string;
  latencyMs: number;
};

/** Порт LLM geo enrich (структурированный результат Wave 7). */
export type LlmGeoEnricherPort = {
  enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LlmOpResult<LlmGeoEnrichPayload>>;
};

export type PlaceEnrichmentEnrichers = {
  getDadata(): GeoProviderEnricherPort;
  nominatim: GeoProviderEnricherPort;
  llm: LlmGeoEnricherPort;
};
