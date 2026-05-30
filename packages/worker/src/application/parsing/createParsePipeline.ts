import type { IPlaceCacheRepository } from "@radar/shared";
import { RuleBasedEventClassifier } from "../../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { DadataEnricher } from "../../infrastructure/enrichers/dadataEnricher.js";
import {
  DEFAULT_PIPELINE_ORDER,
  type PipelineStepId,
  type ResolvedEnricherFlags,
} from "../../infrastructure/enrichers/enricherChainFactory.js";
import { LlmEnricher } from "../../infrastructure/enrichers/llmEnricher.js";
import type { LlmRuntimeConfig } from "../../infrastructure/enrichers/llmRuntimeConfig.js";
import { NominatimEnricher } from "../../infrastructure/enrichers/nominatimEnricher.js";
import { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import type { GeoPipelineStep } from "../geo-pipeline/GeoPipelineContext.js";
import { CatalogStep } from "../geo-pipeline/steps/CatalogStep.js";
import { DadataStep } from "../geo-pipeline/steps/DadataStep.js";
import { LlmStep } from "../geo-pipeline/steps/LlmStep.js";
import { NominatimStep } from "../geo-pipeline/steps/NominatimStep.js";
import { LocationResolutionService } from "./locationResolutionService.js";
import { ParsePipelineService } from "./parsePipelineService.js";
import { InMemoryPlaceCacheRepository } from "../handlers/inMemoryRepositories.js";

/** Конфиг пайплайна, сериализуемый в worker_threads. */
export type ParsePipelineWorkerConfig = {
  enricherFlags: ResolvedEnricherFlags;
  pipelineOrder: PipelineStepId[];
  llmRuntimeConfig: LlmRuntimeConfig;
};

function createStepFactories(params: {
  geoCatalog: GeoCatalog;
  flags: ResolvedEnricherFlags;
  llmRuntimeConfig: LlmRuntimeConfig;
  placeCache: IPlaceCacheRepository;
}): Record<PipelineStepId, () => GeoPipelineStep | null> {
  const { geoCatalog, flags, llmRuntimeConfig, placeCache } = params;
  return {
    catalog: () => new CatalogStep(geoCatalog),
    llm: () =>
      flags.llm ? new LlmStep(new LlmEnricher(llmRuntimeConfig), geoCatalog) : null,
    dadata: () =>
      flags.dadata
        ? new DadataStep(new DadataEnricher(process.env.DADATA_TOKEN), placeCache)
        : null,
    nominatim: () =>
      flags.nominatim ? new NominatimStep(new NominatimEnricher(), placeCache) : null,
  };
}

/**
 * SSOT сборки ParsePipelineService (main thread и worker_threads).
 */
export function createParsePipeline(
  config: ParsePipelineWorkerConfig,
  placeCache?: IPlaceCacheRepository,
): { pipeline: ParsePipelineService; resolution: LocationResolutionService } {
  const geoCatalog = GeoCatalog.loadFromArtifacts();
  const classifier = new RuleBasedEventClassifier();
  const cache = placeCache ?? new InMemoryPlaceCacheRepository();
  const stepFactories = createStepFactories({
    geoCatalog,
    flags: config.enricherFlags,
    llmRuntimeConfig: config.llmRuntimeConfig,
    placeCache: cache,
  });

  const steps: GeoPipelineStep[] = (config.pipelineOrder ?? DEFAULT_PIPELINE_ORDER)
    .map((id) => stepFactories[id]())
    .filter((s): s is GeoPipelineStep => s !== null);

  const resolution = new LocationResolutionService(steps);
  const pipeline = new ParsePipelineService(classifier, resolution);
  return { pipeline, resolution };
}
