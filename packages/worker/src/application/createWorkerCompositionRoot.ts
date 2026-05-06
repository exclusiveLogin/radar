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
  CachingEnricher,
  CompositeEnricher,
  DadataEnricher,
  LlmEnricher,
  NominatimEnricher,
} from "../infrastructure/enrichers/index.js";
import { LocationResolutionService } from "./parsing/locationResolutionService.js";
import { GeoValidationService } from "./parsing/geoValidationService.js";

export function createWorkerCompositionRoot() {
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
  const placeCache = new InMemoryPlaceCacheRepository();
  const classifier = new RuleBasedEventClassifier();
  const compositeEnricher = new CompositeEnricher([
    new DadataEnricher(process.env.DADATA_TOKEN),
    new NominatimEnricher(),
    new LlmEnricher(),
  ]);
  const cachedEnricher = new CachingEnricher(compositeEnricher, placeCache);
  const resolution = new LocationResolutionService(cachedEnricher);
  const validation = new GeoValidationService(regions, places, aliases);

  const ingestRawMessageHandler = new IngestRawMessageHandler(rawMessages, bus);
  const parseRawMessageHandler = new ParseRawMessageHandler(
    classifier,
    parsedEvents,
    eventLocations,
    resolution,
    validation,
    placeCache,
    bus,
  );

  return {
    bus,
    metricsAggregator,
    ingestRawMessageHandler,
    parseRawMessageHandler,
  };
}
