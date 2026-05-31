/**
 * Composition root worker: DataSource, repos, InProcessEventBus, OutboxRelay (db mode).
 * Это wiring зависимостей, не Unit of Work — см. docs.
 * @see ../../../../docs/domain/how-it-works.md#composition-root-flow
 * @see ../../../../docs/domain/unit-of-work-and-transactions.md
 * @see ../../../../docs/domain/domain-events-and-outbox.md
 */
import type { DataSource } from "typeorm";
import type {
  IChannelRepository,
  IEventLocationRepository,
  IIngestBackfillJobRepository,
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
import {
  ParseAttemptLogger,
  ParseAttemptWriter,
  MetricsAggregator,
} from "./subscribers/index.js";
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
import { loadRegionAdjacency } from "../infrastructure/geo-catalog/adjacencyLoader.js";
import {
  isMapStateExpiryEnabled,
  resolveMapStateExpiryPollMs,
  resolveMapStateTtlMs,
} from "../infrastructure/config/mapStateExpiryConfig.js";
import { MapStateExpiryDaemon } from "./map-state/mapStateExpiryDaemon.js";
import { MapStateExpirySweep } from "./map-state/mapStateExpirySweep.js";
import { RegionStateProjection } from "./subscribers/regionStateProjection.js";
import { GeoValidationService } from "./parsing/geoValidationService.js";
import { createParsePipeline } from "./parsing/createParsePipeline.js";
import { isParseWorkerPoolEnabled, ParseWorkerPool } from "./parsing/parseWorkerPool.js";
import {
  BackfillDaemonService,
  isBackfillDaemonEnabled,
} from "./ingest/backfillDaemonService.js";
import {
  WorkerStorageMode,
  resolveWorkerStorageModeFromEnv,
} from "../infrastructure/persistence/storageMode.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { importApiDistModule } from "../infrastructure/persistence/resolveApiDistModule.js";
import type { ApiOutboxModule } from "../infrastructure/persistence/workerDbRepos.types.js";
import { IngestOrchestrator } from "./ingest/ingestOrchestrator.js";
import { SessionResolver } from "./sessions/sessionResolver.js";
import {
  resolveTelegramAppCredentials,
  toTelegramMtprotoAppCredentials,
} from "../infrastructure/telegram/telegramAppCredentials.js";

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
  let backfillDaemon: BackfillDaemonService | undefined;
  let mapStateExpiryDaemon: MapStateExpiryDaemon | undefined;
  let parseWorkerPool: ParseWorkerPool | undefined;
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
  let backfillJobs: IIngestBackfillJobRepository | undefined;

  if (storageMode === WorkerStorageMode.Db) {
    dataSource = await createWorkerDataSource();
    const repos = await createWorkerDbRepositories(dataSource);
    const { OutboxRelay } = (await importApiDistModule(
      "infrastructure",
      "events",
      "outboxRelay.js",
    )) as ApiOutboxModule;

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
    backfillJobs = repos.backfillJobs;

    // Технический след парсинга в БД (parse_attempts) для лога/агрегатов админки.
    const parseAttemptWriter = new ParseAttemptWriter(repos.parseAttempts);
    bus.subscribe("MessageParsed", parseAttemptWriter.handler);
    bus.subscribe("MessageParseFailed", parseAttemptWriter.handler);

    // Проекция операционного состояния регионов: MessageParsed -> place_status + region_state.
    const regionStateProjection = new RegionStateProjection({
      regionState: repos.regionState,
      placeStatus: repos.placeStatus,
      statusDictionary: repos.statusDictionary,
      regions: repos.regions,
      adjacency: loadRegionAdjacency(),
    });
    bus.subscribe("MessageParsed", regionStateProjection.handler);

    if (isMapStateExpiryEnabled()) {
      const sweep = new MapStateExpirySweep({
        regionState: repos.regionState,
        placeStatus: repos.placeStatus,
        regions: repos.regions,
        adjacency: loadRegionAdjacency(),
        ttlMs: resolveMapStateTtlMs(),
      });
      mapStateExpiryDaemon = new MapStateExpiryDaemon(
        sweep,
        resolveMapStateExpiryPollMs(),
      );
    }

    outboxRelay = new OutboxRelay(dataSource, bus);
    outboxRelay.start();

    shutdown = async () => {
      outboxRelay?.stop();
      mapStateExpiryDaemon?.stop();
      await backfillDaemon?.stop();
      await parseWorkerPool?.shutdown();
      await ingestOrchestrator?.stop();
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    };
  }

  const placeCache = options.placeCacheRepository ?? new InMemoryPlaceCacheRepository();
  const geoCatalog = options.geoCatalog ?? GeoCatalog.loadFromArtifacts();

  const llmRuntimeConfig = {
    ...loadLlmRuntimeConfig(),
    ...(options.llmRuntimeOverride ?? {}),
  };
  const flags = resolveEnricherFlags(options.explicitEnricherFlags);
  const order = resolvePipelineOrder(options.pipelineOrder);
  const pipelineConfig = {
    enricherFlags: flags,
    pipelineOrder: order,
    llmRuntimeConfig,
  };
  const { pipeline, resolution } = createParsePipeline(pipelineConfig, placeCache);
  const validation = new GeoValidationService(regions, places, aliases, placeEvidence);

  if (storageMode === WorkerStorageMode.Db && isParseWorkerPoolEnabled()) {
    parseWorkerPool = new ParseWorkerPool(pipelineConfig);
  }

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
    parseWorkerPool,
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
    const telegramMtprotoApp = toTelegramMtprotoAppCredentials(
      resolveTelegramAppCredentials(),
    );
    ingestOrchestrator = new IngestOrchestrator(
      ingestProviders,
      ingestBindings,
      channels,
      ingestRawMessageHandler,
      bus,
      sessionResolver,
      telegramMtprotoApp,
    );

    if (backfillJobs && cursors && isBackfillDaemonEnabled()) {
      backfillDaemon = new BackfillDaemonService(
        backfillJobs,
        ingestProviders,
        ingestBindings,
        channels,
        cursors,
        ingestRawMessageHandler,
        sessionResolver,
        telegramMtprotoApp,
      );
    }
  }

  return {
    storageMode,
    bus,
    metricsAggregator,
    geoCatalog,
    locationResolutionService: resolution,
    parsePipelineService: pipeline,
    parseWorkerPool,
    ingestRawMessageHandler,
    parseRawMessageHandler,
    ingestOrchestrator,
    backfillDaemon,
    mapStateExpiryDaemon,
    outboxRelay,
    dataSource,
    shutdown,
  };
}
