import type { LocationCandidate, LocationEnrichInput } from "@radar/shared";

/** Порт dadata/nominatim — application без concrete infra-классов. */
export type GeoProviderEnricherPort = {
  enrich(input: LocationEnrichInput): Promise<LocationCandidate | null>;
  isSuggestionsBlocked?(): boolean;
};

/** Порт LLM geo enrich. */
export type LlmGeoEnricherPort = {
  enrich(input: { rawText: string; regionCode?: string }): Promise<
    | {
        places?: Array<{ placeName?: string; placeFias?: string | null; confidence?: number }>;
        confidence?: number;
        model: string;
        latencyMs: number;
      }
    | null
  >;
};

export type PlaceEnrichmentEnrichers = {
  getDadata(): GeoProviderEnricherPort;
  nominatim: GeoProviderEnricherPort;
  llm: LlmGeoEnricherPort;
};