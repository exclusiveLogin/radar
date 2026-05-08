import type { ILocationEnricher, IPlaceCacheRepository } from "@radar/shared";
import { InProcessEventBus } from "@radar/shared";
import { ParseAttemptLogger, MetricsAggregator } from "./subscribers/index.js";
import { IngestRawMessageHandler } from "./handlers/ingestRawMessageHandler.js";
import { ParseRawMessageHandler } from "./handlers/parseRawMessageHandler.js";
import {
  InMemoryEventLocationRepository,
  InMemoryPlaceAliasRepository,
  InMemoryPlaceCacheRepository,
  InMemoryPlaceRepository,
  InMemoryParsedEventRepository,
  InMemoryRegionRepository,
  InMemoryRawMessageRepository,
} from "./handlers/inMemoryRepositories.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import {
  buildEnricherChain,
  CachingEnricher,
  resolveEnricherFlagsFromEnv,
  wrapEnricherFallback,
} from "../infrastructure/enrichers/index.js";
import { loadLlmRuntimeConfig } from "../infrastructure/enrichers/llmRuntimeConfig.js";
import { GeoCatalog } from "../infrastructure/geo-catalog/index.js";
import { LocationResolutionService } from "./parsing/locationResolutionService.js";
import { GeoValidationService } from "./parsing/geoValidationService.js";
import { ParsePipelineService } from "./parsing/parsePipelineService.js";

export type WorkerCompositionOptions = {
  placeCacheRepository?: IPlaceCacheRepository;
  geoCatalog?: GeoCatalog;
  enableProviders?: boolean;
};

export function createWorkerCompositionRoot(options: WorkerCompositionOptions = {}) {
  const bus = new InProcessEventBus();
  const parseAttemptLogger = new ParseAttemptLogger();
  const metricsAggregator = new MetricsAggregator();

  bus.subscribe("MessageParsed", parseAttemptLogger.handler);
  bus.subscribe("MessageParseFailed", parseAttemptLogger.handler);
  bus.subscribe("*", metricsAggregator.handler);

  const rawMessages = new InMemoryRawMessageRepository();
  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const placeCache = options.placeCacheRepository ?? new InMemoryPlaceCacheRepository();
  const classifier = new RuleBasedEventClassifier();
  const geoCatalog = options.geoCatalog ?? GeoCatalog.loadFromArtifacts();
  const llmRuntimeConfig = loadLlmRuntimeConfig();
  const envFlags = resolveEnricherFlagsFromEnv();
  const effectiveFlags =
    options.enableProviders === false
      ? { dadata: false, nominatim: false, llm: false }
      : envFlags;
  const enrichers: ILocationEnricher[] = buildEnricherChain(
    effectiveFlags,
    llmRuntimeConfig,
    process.env.DADATA_TOKEN,
  );

  const compositeEnricher = wrapEnricherFallback(enrichers);
  const cachedEnricher = new CachingEnricher(compositeEnricher, placeCache);
  const resolution = new LocationResolutionService(geoCatalog, cachedEnricher);
  const pipeline = new ParsePipelineService(classifier, resolution);
  const validation = new GeoValidationService(regions, places, aliases);

  const ingestRawMessageHandler = new IngestRawMessageHandler(rawMessages, bus);
  const parseRawMessageHandler = new ParseRawMessageHandler(
    pipeline,
    parsedEvents,
    eventLocations,
    validation,
    placeCache,
    bus,
  );

  return {
    bus,
    metricsAggregator,
    geoCatalog,
    parsePipelineService: pipeline,
    ingestRawMessageHandler,
    parseRawMessageHandler,
  };
}
