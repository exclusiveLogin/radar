import { DadataEnricher } from "./dadataEnricher.js";
import { loadDadataToken } from "./dadataConfig.js";
import { LlmEnricher } from "./llmEnricher.js";
import { loadLlmRuntimeConfig } from "./llmRuntimeConfig.js";
import { NominatimEnricher } from "./nominatimEnricher.js";
import type { PlaceEnrichmentEnrichers } from "../../application/geo-parse/placeGeoEnricherPort.js";

/** Wire concrete enrichers за port-контракт (только composition/boot). */
export function createPlaceEnrichmentEnrichers(): PlaceEnrichmentEnrichers {
  let dadata: DadataEnricher | undefined;
  return {
    getDadata: () => {
      dadata ??= new DadataEnricher(loadDadataToken());
      return dadata;
    },
    nominatim: new NominatimEnricher(),
    llm: new LlmEnricher(loadLlmRuntimeConfig()),
  };
}