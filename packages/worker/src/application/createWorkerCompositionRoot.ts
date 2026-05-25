import type { DataSource } from "typeorm";
import type {
  IChannelRepository,
  IEventLocationRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IParsedEventRepository,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionRepository,
} from "@radar/shared";
import { InProcessEventBus } from "@radar/shared";
import { ParseAttemptLogger, MetricsAggregator } from "./subscribers/index.js";
import { createRawMessageIngestedHandler } from "./subscribers/rawMessageIngestedSubscriber.js";
import { IngestRawMessageHandler } from "./handlers/ingestRawMessageHandler.js";
import { ParseRawMessageHandler } from "./handlers/parseRawMessageHandler.js";
import {
  InMemoryEventLocationRepository,
  InMemoryPlaceAliasRepository,
  InMemoryPlaceCacheRepository,
  InMemoryPlaceEvidenceRepository,
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
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import type { ApiOutboxModule } from "../infrastructure/persistence/workerDbRepos.types.js";
import { IngestOrchestrator } from "./ingest/ingestOrchestrator.js";
import { SessionResolver } from "./sessions/sessionResolver.js";

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

function resolveEnricherFlags(
  explicit: WorkerCompositionOptions["explicitEnricherFlags"],
): ResolvedEnricherFlags {
  if (explicit === false) {
    return { dadata: false, nominatim: false, llm: false };
  }
  return explicit ?? resolveEnricherFlagsFromEnv();
}

function resolvePipelineOrder(
  override: WorkerCompositionOptions["pipelineOrder"],
): PipelineStepId[] {
  return override ?? resolvePipelineOrderFromEnv() ?? DEFAULT_PIPELINE_ORDER;
}

function createStepFactories(params: {
  geoCatalog: GeoCatalog;
  flags: ResolvedEnricherFlags;
  llmRuntimeConfig: LlmRuntimeConfig;
  placeCache: IPlaceCacheRepository;
}): Record<PipelineStepId, () => GeoPipelineStep | null> {
  const { geoCatalog, flags, llmRuntimeConfig, placeCache } = params;
  return {
    catalog: () => new CatalogStep(geoCatalog),
    llm: () => (flags.llm ? new LlmStep(new LlmEnricher(llmRuntimeConfig)) : null),
    dadata: () =>
      flags.dadata
        ? new DadataStep(new DadataEnricher(process.env.DADATA_TOKEN), placeCache)
        : null,
    nominatim: () =>
      flags.nominatim ? new NominatimStep(new NominatimEnricher(), placeCache) : null,
  };
}

export async function createWorkerCompositionRoot(
  options: WorkerCompositionOptions = {},
) {
  const storageMode = options.storageMode ?? resolveWorkerStorageModeFromEnv();

  const bus = new InProcessEventBus();
  const parseAttemptLogger = new ParseAttemptLogger();
  const metricsAggregator = new MetricsAggregator();

  bus.subscribe("MessageParsed", parseAttemptLogger.handler);
  bus.subscribe("MessageParseFailed", parseAttemptLogger.handler);
  bus.subscribe("*", metricsAggregator.handler);

  let dataSource: DataSource | undefined;
  let outboxRelay: { start: () => void; stop: () => void } | undefined;
  let ingestOrchestrator: IngestOrchestrator | undefined;
  let shutdown: (() => Promise<void>) | undefined;

  let rawMessages: IRawMessageRepository = new InMemoryRawMessageRepository();
  let parsedEvents: IParsedEventRepository = new InMemoryParsedEventRepository();
  let eventLocations: IEventLocationRepository = new InMemoryEventLocationRepository();
  let regions: IRegionRepository = new InMemoryRegionRepository();
  let places: IPlaceRepository = new InMemoryPlaceRepository();
  let aliases: IPlaceAliasRepository = new InMemoryPlaceAliasRepository();
  let placeEvidence: IPlaceEvidenceRepository = new InMemoryPlaceEvidenceRepository();
  let cursors: IIngestCursorRepository | undefined;
  let ingestProviders: IIngestProviderRepository | undefined;
  let ingestBindings: IIngestBindingRepository | undefined;
  let channels: IChannelRepository | undefined;

  if (storageMode === WorkerStorageMode.Db) {
    dataSource = await createWorkerDataSource();
    const repos = await createWorkerDbRepositories(dataSource);
    const outboxPath = ["..", "..", "..", "api", "src", "infrastructure", "events", "outboxRelay.js"].join(
      "/",
    );
    const { OutboxRelay } = (await import(outboxPath)) as ApiOutboxModule;

    rawMessages = repos.rawMessages;
    parsedEvents = repos.parsedEvents;
    eventLocations = repos.eventLocations;
    regions = repos.regions;
    places = repos.places;
    aliases = repos.aliases;
    placeEvidence = repos.placeEvidence;
    cursors = repos.cursors;
    ingestProviders = repos.ingestProviders;
    ingestBindings = repos.ingestBindings;
    channels = repos.channels;

    outboxRelay = new OutboxRelay(dataSource, bus);
    outboxRelay.start();

    shutdown = async () => {
      outboxRelay?.stop();
      await ingestOrchestrator?.stop();
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    };
  }

  const placeCache = options.placeCacheRepository ?? new InMemoryPlaceCacheRepository();
  const classifier = new RuleBasedEventClassifier();
  const geoCatalog = options.geoCatalog ?? GeoCatalog.loadFromArtifacts();

  const llmRuntimeConfig = {
    ...loadLlmRuntimeConfig(),
    ...(options.llmRuntimeOverride ?? {}),
  };
  const flags = resolveEnricherFlags(options.explicitEnricherFlags);
  const order = resolvePipelineOrder(options.pipelineOrder);
  const stepFactories = createStepFactories({
    geoCatalog,
    flags,
    llmRuntimeConfig,
    placeCache,
  });

  const steps: GeoPipelineStep[] = order
    .map((id) => stepFactories[id]())
    .filter((s): s is GeoPipelineStep => s !== null);

  const resolution = new LocationResolutionService(steps);
  const pipeline = new ParsePipelineService(classifier, resolution);
  const validation = new GeoValidationService(regions, places, aliases, placeEvidence);

  const ingestRawMessageHandler = new IngestRawMessageHandler(
    rawMessages,
    bus,
    cursors,
  );
  const parseRawMessageHandler = new ParseRawMessageHandler(
    pipeline,
    parsedEvents,
    eventLocations,
    validation,
    placeCache,
    bus,
  );

  bus.subscribe(
    "RawMessageIngested",
    createRawMessageIngestedHandler({
      rawMessages,
      parseHandler: parseRawMessageHandler,
    }),
  );

  if (
    storageMode === WorkerStorageMode.Db &&
    ingestProviders &&
    ingestBindings &&
    channels
  ) {
    const sessionResolver = new SessionResolver();
    ingestOrchestrator = new IngestOrchestrator(
      ingestProviders,
      ingestBindings,
      channels,
      ingestRawMessageHandler,
      bus,
      sessionResolver,
    );
  }

  return {
    storageMode,
    bus,
    metricsAggregator,
    geoCatalog,
    locationResolutionService: resolution,
    parsePipelineService: pipeline,
    ingestRawMessageHandler,
    parseRawMessageHandler,
    ingestOrchestrator,
    outboxRelay,
    dataSource,
    shutdown,
  };
}
