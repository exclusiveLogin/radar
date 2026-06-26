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
  IEventEvidenceRepository,
  IEventLocationRepository,
  IIngestBackfillJobRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceEnrichmentJobRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionRepository,
  IPlaceScanPort,
} from "@radar/shared";
import { InProcessEventBus } from "@radar/shared";
import {
  ParseAttemptLogger,
  ParseAttemptWriter,
  MetricsAggregator,
} from "./subscribers/index.js";
import { createPhaseIngestHandler } from "./subscribers/phaseIngestSubscriber.js";
import { createRawMessageIngestedHandler } from "./subscribers/rawMessageIngestedSubscriber.js";
import { CoverageEnqueuer } from "./phases/coverageEnqueuer.js";
import { PhaseRunner } from "./phases/phaseRunner.js";
import { IngestParseDaemonService } from "./phases/ingestParseDaemonService.js";
import { PhaseManualRunPoller } from "./phases/phaseManualRunPoller.js";
import { PlaceEnrichmentDaemonService } from "./geo-parse/placeEnrichmentDaemonService.js";
import { PlaceEnrichmentRunner } from "./geo-parse/placeEnrichmentRunner.js";
import { IngestRawMessageHandler } from "./handlers/ingestRawMessageHandler.js";
import { ParseRawMessageHandler } from "./handlers/parseRawMessageHandler.js";
import {
  InMemoryEventLocationRepository,
  InMemoryEventEvidenceRepository,
  InMemoryPlaceAliasRepository,
  InMemoryPlaceCacheRepository,
  InMemoryPlaceEnrichmentJobRepository,
  InMemoryPlaceRepository,
  InMemoryParsedEventRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryRegionRepository,
  InMemoryRawMessageRepository,
} from "./handlers/inMemoryRepositories.js";
import { MONOREPO_ROOT } from "@repo/root";
import { GeoValidationService } from "./parsing/geoValidationService.js";
import { createPlaceScanService } from "../infrastructure/place-scan/createPlaceScanService.js";
import { createParseWorkspaceStack } from "./parse/createParseWorkspaceStack.js";
import {
  loadAllIngestParsePhases,
  loadIngestParsePhases,
  selectIngestParsePhases,
  type IngestParsePhaseSelection,
} from "./parse/loadIngestParsePhases.js";
import { createParsePipeline, type ParsePipelineWorkerConfig } from "./parsing/createParsePipeline.js";
import { isParseWorkerPoolEnabled, ParseWorkerPool } from "./parsing/parseWorkerPool.js";
import {
  BackfillDaemonService,
  isBackfillDaemonEnabled,
} from "./ingest/backfillDaemonService.js";
import {
  TrackingRebuildDaemon,
  isTrackingDaemonEnabled,
} from "./tracking/trackingRebuildDaemon.js";
import {
  TrackingTuneDaemon,
  isTrackingTuneDaemonEnabled,
} from "./tracking/trackingTuneDaemon.js";
import {
  WorkerStorageMode,
  resolveWorkerStorageModeFromEnv,
} from "../infrastructure/persistence/storageMode.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { importApiDistModule } from "../infrastructure/persistence/resolveApiDistModule.js";
import type {
  ApiOutboxModule,
  WorkerDbRepositories,
} from "../infrastructure/persistence/workerDbRepos.types.js";
import { IngestOrchestrator } from "./ingest/ingestOrchestrator.js";
import { SessionResolver } from "./sessions/sessionResolver.js";
import {
  resolveTelegramAppCredentials,
  toTelegramMtprotoAppCredentials,
} from "../infrastructure/telegram/telegramAppCredentials.js";
import {
  resolveWorkerRoleFromEnv,
  rolePublishesIngestToOutbox,
  roleRunsBackfill,
  roleRunsLiveIngest,
  roleRunsOutboxRelay,
  roleRunsPhaseDaemons,
  roleRunsTrackingDaemon,
  roleSubscribesPhaseIngestOnBus,
  type WorkerRole,
} from "../infrastructure/config/workerRole.js";
import type { IngestEventPublisher } from "./handlers/ingestEventPublishMode.js";

export type WorkerCompositionOptions = {
  storageMode?: WorkerStorageMode;
  /** Роль процесса; default — env RADAR_WORKER_ROLE или `all`. */
  workerRole?: WorkerRole;
  placeCacheRepository?: IPlaceCacheRepository;
  /** Override DB-backed geo scan (tests / offline CLI). */
  placeScan?: IPlaceScanPort;
  /**
   * Override ingestParse-фаз для offline CLI (snap/report).
   * Default / `{ kind: "manifest" }` — enabled фазы из phase.manifest (prod parity).
   */
  ingestParsePhaseSelection?: IngestParsePhaseSelection;
  /** @deprecated Используй ingestParsePhaseSelection / CLI --phases. */
  explicitEnricherFlags?: false;
  /** @deprecated Используй ingestParsePhaseSelection / CLI --phases. */
  pipelineOrder?: never;
  /** @deprecated Используй ingestParsePhaseSelection / CLI --phases. */
  llmRuntimeOverride?: never;
  /**
   * IngestParseDaemon (scheduled ingestParse). Для one-shot CLI — false;
   * догон — в `worker:dev` / `parse-engine:ingest:drain`.
   */
  startIngestParseDaemon?: boolean;
};

export async function createWorkerCompositionRoot(
  options: WorkerCompositionOptions = {},
) {
  const storageMode = options.storageMode ?? resolveWorkerStorageModeFromEnv();
  const workerRole = options.workerRole ?? resolveWorkerRoleFromEnv();

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
  let trackingRebuildDaemon: TrackingRebuildDaemon | undefined;
  let trackingTuneDaemon: TrackingTuneDaemon | undefined;
  let ingestParseDaemon: IngestParseDaemonService | undefined;
  let placeEnrichmentDaemon: PlaceEnrichmentDaemonService | undefined;
  let phaseManualRunPoller: PhaseManualRunPoller | undefined;
  let phaseRunner: PhaseRunner | undefined;
  let coverageEnqueuer: CoverageEnqueuer | undefined;
  let parseWorkerPool: ParseWorkerPool | undefined;
  let shutdown: (() => Promise<void>) | undefined;

  let rawMessages: IRawMessageRepository = new InMemoryRawMessageRepository();
  let parsedEvents: IParsedEventRepository = new InMemoryParsedEventRepository();
  let messageParseWorkspaces: IMessageParseWorkspaceRepository =
    new InMemoryMessageParseWorkspaceRepository();
  let eventLocations: IEventLocationRepository = new InMemoryEventLocationRepository();
  let eventEvidence: IEventEvidenceRepository = new InMemoryEventEvidenceRepository();
  let regions: IRegionRepository = new InMemoryRegionRepository();
  let places: IPlaceRepository = new InMemoryPlaceRepository();
  let aliases: IPlaceAliasRepository = new InMemoryPlaceAliasRepository();
  let placeEnrichmentJobs: IPlaceEnrichmentJobRepository = new InMemoryPlaceEnrichmentJobRepository();
  let cursors: IIngestCursorRepository | undefined;
  let ingestProviders: IIngestProviderRepository | undefined;
  let ingestBindings: IIngestBindingRepository | undefined;
  let channels: IChannelRepository | undefined;
  let backfillJobs: IIngestBackfillJobRepository | undefined;
  let workerRepos: WorkerDbRepositories | undefined;
  let placeEnrichmentRunner: PlaceEnrichmentRunner | undefined;

  if (storageMode === WorkerStorageMode.Db) {
    dataSource = await createWorkerDataSource();
    const repos = await createWorkerDbRepositories(dataSource);
    workerRepos = repos;
    const { OutboxRelay } = (await importApiDistModule(
      "infrastructure",
      "events",
      "outboxRelay.js",
    )) as ApiOutboxModule;

    rawMessages = repos.rawMessages;
    parsedEvents = repos.parsedEvents;
    messageParseWorkspaces = repos.messageParseWorkspaces;
    eventLocations = repos.eventLocations;
    eventEvidence = repos.eventEvidence;
    regions = repos.regions;
    places = repos.places;
    aliases = repos.aliases;
    placeEnrichmentJobs = repos.placeEnrichmentJobs;
    cursors = repos.cursors;
    ingestProviders = repos.ingestProviders;
    ingestBindings = repos.ingestBindings;
    channels = repos.channels;
    backfillJobs = repos.backfillJobs;
    // Технический след парсинга в БД (parse_attempts) для лога/агрегатов админки.
    const parseAttemptWriter = new ParseAttemptWriter(repos.parseAttempts);
    bus.subscribe("MessageParsed", parseAttemptWriter.handler);
    bus.subscribe("MessageParseFailed", parseAttemptWriter.handler);

    outboxRelay = new OutboxRelay(dataSource, bus);
    if (roleRunsOutboxRelay(workerRole)) {
      outboxRelay.start();
    }

    shutdown = async () => {
      outboxRelay?.stop();
      phaseManualRunPoller?.stop();
      ingestParseDaemon?.stop();
      placeEnrichmentDaemon?.stop();
      await backfillDaemon?.stop();
      await trackingRebuildDaemon?.stop();
      await trackingTuneDaemon?.stop();
      await parseWorkerPool?.shutdown();
      await ingestOrchestrator?.stop();
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    };
  }

  const placeCache = options.placeCacheRepository ?? new InMemoryPlaceCacheRepository();
  const placeScan = options.placeScan ?? await createPlaceScanService({ places, regions });
  // CLI/test override — не тянем places.listScanEntries (DB repo из api/dist может быть устаревшим).
  const placeScanEntries =
    options.placeScan != null ? [] : await places.listScanEntries();
  const placeScanRevision = placeScan.revision();

  const phaseDefinitions = workerRepos?.phaseDefinitions;
  const phaseSelection = options.ingestParsePhaseSelection ?? { kind: "manifest" };
  const ingestParsePhases =
    phaseSelection.kind === "manifest"
      ? await loadIngestParsePhases({
          repoRoot: MONOREPO_ROOT,
          phaseDefinitions,
        })
      : selectIngestParsePhases(
          await loadAllIngestParsePhases({
            repoRoot: MONOREPO_ROOT,
            phaseDefinitions,
          }),
          phaseSelection,
        );
  const parsePipelineWorkerConfig: ParsePipelineWorkerConfig = {
    ingestParsePhases,
    placeScanEntries,
    placeScanRevision,
  };
  const { pipeline } = createParsePipeline({
    placeScan,
    regions,
    ingestParsePhases,
    places,
  });
  const validation = new GeoValidationService(regions, places, aliases);

  if (storageMode === WorkerStorageMode.Db && isParseWorkerPoolEnabled()) {
    parseWorkerPool = new ParseWorkerPool(parsePipelineWorkerConfig);
  }

  const ingestEventPublisher: IngestEventPublisher =
    workerRepos && rolePublishesIngestToOutbox(workerRole)
      ? { mode: "outbox", outbox: workerRepos.domainEvents }
      : { mode: "bus", bus };

  const ingestRawMessageHandler = new IngestRawMessageHandler(
    rawMessages,
    ingestEventPublisher,
    cursors,
  );
  const { workspaceService } = createParseWorkspaceStack({
    placeScan,
    regions,
    places,
    validation,
    parsedEvents,
    eventLocations,
    messageParseWorkspaces,
  });
  const parseRawMessageHandler = new ParseRawMessageHandler(
    workspaceService,
    parsedEvents,
    eventLocations,
    eventEvidence,
    bus,
  );

  if (workerRepos) {
    placeEnrichmentRunner = new PlaceEnrichmentRunner(
      workerRepos.placeEnrichmentJobs,
      workerRepos.places,
      workerRepos.aliases,
      workerRepos.regions,
    );
    phaseRunner = new PhaseRunner({
      rawMessages: workerRepos.rawMessages,
      coverage: workerRepos.phaseCoverage,
      phaseDefinitions: workerRepos.phaseDefinitions,
      phaseRuns: workerRepos.phaseRuns,
      parsedEvents: workerRepos.parsedEvents,
      messageParseWorkspaces: workerRepos.messageParseWorkspaces,
      eventLocations: workerRepos.eventLocations,
      eventEvidence: workerRepos.eventEvidence,
      placeEnrichmentJobs: workerRepos.placeEnrichmentJobs,
      places: workerRepos.places,
      regions: workerRepos.regions,
      validation,
      placeScan,
      placeCache,
      events: bus,
      placeEnrichmentRunner,
    });
    coverageEnqueuer = new CoverageEnqueuer(
      workerRepos.phaseCoverage,
      workerRepos.phaseDefinitions,
    );
    if (roleSubscribesPhaseIngestOnBus(workerRole)) {
      bus.subscribe(
        "RawMessageIngested",
        createPhaseIngestHandler({
          rawMessages: workerRepos.rawMessages,
          phases: workerRepos.phaseDefinitions,
          enqueuer: coverageEnqueuer,
          runner: phaseRunner,
        }),
      );
    }
    const startPhaseDaemons =
      roleRunsPhaseDaemons(workerRole) &&
      IngestParseDaemonService.enabled() &&
      options.startIngestParseDaemon !== false;
    if (startPhaseDaemons) {
      ingestParseDaemon = new IngestParseDaemonService(
        workerRepos.phaseDefinitions,
        workerRepos.phaseRuns,
        workerRepos.phaseCoverage,
        phaseRunner,
      );
      ingestParseDaemon.start();
      phaseManualRunPoller = new PhaseManualRunPoller(
        workerRepos.phaseDefinitions,
        workerRepos.phaseRuns,
        phaseRunner,
      );
      phaseManualRunPoller.start();

      placeEnrichmentDaemon = new PlaceEnrichmentDaemonService(
        workerRepos.phaseDefinitions,
        workerRepos.phaseRuns,
        workerRepos.placeEnrichmentJobs,
        phaseRunner,
      );
      placeEnrichmentDaemon.start();
    }
  } else {
    bus.subscribe(
      "RawMessageIngested",
      createRawMessageIngestedHandler({
        rawMessages,
        parseHandler: parseRawMessageHandler,
      }),
    );
  }

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

    if (roleRunsLiveIngest(workerRole)) {
      ingestOrchestrator = new IngestOrchestrator(
        ingestProviders,
        ingestBindings,
        channels,
        ingestRawMessageHandler,
        bus,
        sessionResolver,
        telegramMtprotoApp,
      );
    }

    if (
      roleRunsBackfill(workerRole) &&
      backfillJobs &&
      cursors &&
      isBackfillDaemonEnabled()
    ) {
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

    if (roleRunsTrackingDaemon(workerRole) && dataSource && isTrackingDaemonEnabled()) {
      trackingRebuildDaemon = new TrackingRebuildDaemon(dataSource);
    }
    if (roleRunsTrackingDaemon(workerRole) && dataSource && isTrackingTuneDaemonEnabled()) {
      trackingTuneDaemon = new TrackingTuneDaemon(dataSource);
    }

  }

  return {
    storageMode,
    workerRole,
    bus,
    metricsAggregator,
    placeScan,
    parsePipelineService: pipeline,
    ingestParsePhases,
    parseWorkerPool,
    workspaceService,
    ingestRawMessageHandler,
    parseRawMessageHandler,
    ingestOrchestrator,
    backfillDaemon,
    trackingRebuildDaemon,
    trackingTuneDaemon,
    ingestParseDaemon,
    placeEnrichmentDaemon,
    placeEnrichmentRunner,
    phaseRunner,
    coverageEnqueuer,
    workerRepos,
    outboxRelay,
    dataSource,
    shutdown,
  };
}
