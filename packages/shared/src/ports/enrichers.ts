export type LocationCandidate = {
  provider: "dadata" | "nominatim" | "llm";
  queryNorm: string;
  regionCode?: string;
  placeName?: string;
  placeFias?: string;
  lat?: number;
  lon?: number;
  raw: Record<string, unknown>;
};

export type LocationEnrichInput = {
  rawText: string;
  regionCode?: string;
  /** ISO3166-1 alpha2 для Nominatim (ru, ua). */
  countryCode?: string;
  /** Bbox региона — мягкая привязка Nominatim viewbox. */
  viewbox?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
};

export interface ILocationEnricher {
  readonly name: "dadata" | "nominatim" | "llm";
  enrich(input: LocationEnrichInput): Promise<LocationCandidate | null>;
}
