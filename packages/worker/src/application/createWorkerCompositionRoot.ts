import type { IPlaceCacheRepository } from "@radar/shared";
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
import { DadataEnricher } from "../infrastructure/enrichers/dadataEnricher.js";
import { LlmEnricher } from "../infrastructure/enrichers/llmEnricher.js";
import { NominatimEnricher } from "../infrastructure/enrichers/nominatimEnricher.js";
import {
  loadLlmRuntimeConfig,
  type LlmRuntimeConfig,
} from "../infrastructure/enrichers/llmRuntimeConfig.js";
import {
  DEFAULT_PIPELINE_ORDER,
  resolveEnricherFlagsFromEnv,
  resolvePipelineOrderFromEnv,
} from "../infrastructure/enrichers/enricherChainFactory.js";
import type {
  PipelineStepId,
  ResolvedEnricherFlags,
} from "../infrastructure/enrichers/enricherChainFactory.js";
import { GeoCatalog } from "../infrastructure/geo-catalog/index.js";
import type { GeoPipelineStep } from "./geo-pipeline/GeoPipelineContext.js";
import { CatalogStep } from "./geo-pipeline/steps/CatalogStep.js";
import { DadataStep } from "./geo-pipeline/steps/DadataStep.js";
import { NominatimStep } from "./geo-pipeline/steps/NominatimStep.js";
import { LlmStep } from "./geo-pipeline/steps/LlmStep.js";
import { LocationResolutionService } from "./parsing/locationResolutionService.js";
import { GeoValidationService } from "./parsing/geoValidationService.js";
import { ParsePipelineService } from "./parsing/parsePipelineService.js";
import {
  WorkerStorageMode,
  resolveWorkerStorageModeFromEnv,
} from "../infrastructure/persistence/storageMode.js";

export type WorkerCompositionOptions = {
  storageMode?: WorkerStorageMode;
  placeCacheRepository?: IPlaceCacheRepository;
  geoCatalog?: GeoCatalog;
  /**
   * Полная замена env-флагов enrichers (например parse:snap задаёт три булева из CLI).
   * Если false — отключает все внешние провайдеры (только каталог + финалайзер).
   */
  explicitEnricherFlags?: ResolvedEnricherFlags | false;
  /**
   * Явный порядок шагов пайплайна (CLI override).
   * Если не задан — читается из env RADAR_GEO_PIPELINE_ORDER, иначе DEFAULT_PIPELINE_ORDER.
   * `FinalizerStep` всегда добавляется последним в runGeoPipeline автоматически.
   */
  pipelineOrder?: PipelineStepId[];
  /** Поверх `loadLlmRuntimeConfig()` (например `enabled: true` при `--enrich-llm`). */
  llmRuntimeOverride?: Partial<LlmRuntimeConfig>;
};

export function createWorkerCompositionRoot(options: WorkerCompositionOptions = {}) {
  const storageMode = options.storageMode ?? resolveWorkerStorageModeFromEnv();
  if (storageMode === WorkerStorageMode.Db) {
    throw new Error(
      "RADAR_STORAGE_MODE=db is not implemented in worker runtime yet. Use memory/fs for now.",
    );
  }

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

  const llmRuntimeConfig = {
    ...loadLlmRuntimeConfig(),
    ...(options.llmRuntimeOverride ?? {}),
  };

  const flags: ResolvedEnricherFlags =
    options.explicitEnricherFlags === false
      ? { dadata: false, nominatim: false, llm: false }
      : (options.explicitEnricherFlags ?? resolveEnricherFlagsFromEnv());

  // ── Resolve execution order: options → env → default ──────────────────
  const order: PipelineStepId[] =
    options.pipelineOrder ??
    resolvePipelineOrderFromEnv() ??
    DEFAULT_PIPELINE_ORDER;

  // ── Step factory map ───────────────────────────────────────────────────
  const stepFactories: Record<PipelineStepId, () => GeoPipelineStep | null> = {
    catalog: () => new CatalogStep(geoCatalog),
    llm: () => (flags.llm ? new LlmStep(new LlmEnricher(llmRuntimeConfig)) : null),
    dadata: () =>
      flags.dadata ? new DadataStep(new DadataEnricher(process.env.DADATA_TOKEN), placeCache) : null,
    nominatim: () => (flags.nominatim ? new NominatimStep(new NominatimEnricher(), placeCache) : null),
  };

  const steps: GeoPipelineStep[] = order
    .map((id) => stepFactories[id]())
    .filter((s): s is GeoPipelineStep => s !== null);
  // FinalizerStep is always appended inside runGeoPipeline

  const resolution = new LocationResolutionService(steps);
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
    storageMode,
    bus,
    metricsAggregator,
    geoCatalog,
    locationResolutionService: resolution,
    parsePipelineService: pipeline,
    ingestRawMessageHandler,
    parseRawMessageHandler,
  };
}
