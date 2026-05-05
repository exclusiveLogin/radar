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

export interface ILocationEnricher {
  readonly name: "dadata" | "nominatim" | "llm";
  enrich(input: {
    rawText: string;
    regionCode?: string;
  }): Promise<LocationCandidate | null>;
}
