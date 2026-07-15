/**
 * Composition root worker: DataSource, repos, InProcessEventBus, OutboxRelay (db mode).
 * Р­С‚Рѕ wiring Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№, РЅРµ Unit of Work вЂ” СЃРј. docs.
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
  IObservabilityRecorder,
  HostSnapshot,
  IEventTransport,
} from "@radar/shared";
import { InProcessEventBus, PIPELINE_RMQ_QUEUE_SUFFIX, RADAR_TOPICS, resolveRmqConsumerSuffix } from "@radar/shared";
import { loadDeploymentManifest } from "@radar/shared/deployment/deploymentManifest.loader.js";
import { createEventTransport } from "../infrastructure/transport/createEventTransport.js";
import { TransportEventPublisher } from "../infrastructure/transport/transportEventPublisher.js";
import { bridgeTransportTopicToBus } from "../infrastructure/transport/bridgeTransportToBus.js";
import { wireTransportTrigger } from "./runtime/workload/wireTransportTrigger.js";
import { wireTransportRuntimeSignals } from "../infrastructure/transport/wireTransportRuntimeSignals.js";
import { wirePhaseWakeScheduler } from "./phases/phaseWakeScheduler.js";
import { loadWorkerRuntimeManifest } from "@radar/shared/manifest/domains/workerRuntime.loader.js";
import {
  ParseAttemptLogger,
  ParseAttemptWriter,
  MetricsAggregator,
} from "./subscribers/index.js";
import { createPhaseIngestHandler } from "./subscribers/phaseIngestSubscriber.js";
import { createRawMessageIngestedHandler } from "./subscribers/rawMessageIngestedSubscriber.js";
import { CoverageEnqueuer } from "./phases/coverageEnqueuer.js";
import { PhaseRunner } from "./phases/phaseRunner.js";
import { PhaseManualRunPoller } from "./phases/phaseManualRunPoller.js";
import {
  createPipelineLauncher,
  resolveRuntimePipelines,
  type PipelineLauncher,
} from "../composition/runtime/index.js";
import { PlaceEnrichmentRunner } from "./geo-parse/placeEnrichmentRunner.js";
import { odpResolve, type OdpResolution } from "../composition/odp/index.js";
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
import { GeoValidationService } from "./parse/geoValidationService.js";
import { createPlaceScanService } from "../infrastructure/place-scan/createPlaceScanService.js";
import { createParseWorkspaceStack } from "./parse/createParseWorkspaceStack.js";
import {
  loadAllIngestParsePhases,
  loadIngestParsePhases,
  selectIngestParsePhases,
  type IngestParsePhaseSelection,
} from "./parse/loadIngestParsePhases.js";
import { createParsePipeline, type ParsePipelineWorkerConfig } from "./parse/createParsePipeline.js";
import { ParseWorkerPool } from "./parse/parseWorkerPool.js";
import {
  BackfillDaemonService,
} from "./ingest/backfillDaemonService.js";
import {
  WorkerStorageMode,
  resolveWorkerStorageModeFromEnv,
} from "../infrastructure/persistence/storageMode.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import type { WorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.types.js";
import { IngestOrchestrator } from "./ingest/ingestOrchestrator.js";
import { SessionResolver } from "./sessions/sessionResolver.js";
import {
  resolveTelegramAppCredentials,
  toTelegramMtprotoAppCredentials,
} from "../infrastructure/telegram/telegramAppCredentials.js";
import {
  resolveWorkerRoleFromEnv,
  roleRunsBackfill,
  roleRunsLiveIngest,
  roleRunsPhaseDaemons,
  roleRunsParseDaemons,
  roleRunsGeoDaemons,
  roleRunsTrackingDaemon,
  roleSubscribesPhaseIngestOnBus,
  type WorkerRole,
} from "../infrastructure/config/workerRole.js";
import {
  buildObsHostId,
  resolveObsConfig,
} from "../infrastructure/config/obsMode.js";
import { createObservabilityRecorder } from "@radar/observability";
import { createParseWorkerPoolObs } from "./runtime/observability/parseWorkerPoolObs.js";
import type { IngestEventPublisher } from "./handlers/ingestEventPublishMode.js";

export type WorkerCompositionOptions = {
  storageMode?: WorkerStorageMode;
  /** Р РѕР»СЊ РїСЂРѕС†РµСЃСЃР°; default вЂ” env RADAR_WORKER_ROLE РёР»Рё `all`. */
  workerRole?: WorkerRole;
  placeCacheRepository?: IPlaceCacheRepository;
  /** Override DB-backed geo scan (tests / offline CLI). */
  placeScan?: IPlaceScanPort;
  /**
   * Override ingestParse-С„Р°Р· РґР»СЏ offline CLI (snap/report).
   * Default / `{ kind: "manifest" }` вЂ” enabled С„Р°Р·С‹ РёР· phase.manifest (prod parity).
   */
  ingestParsePhaseSelection?: IngestParsePhaseSelection;
  /** @deprecated РСЃРїРѕР»СЊР·СѓР№ ingestParsePhaseSelection / CLI --phases. */
  explicitEnricherFlags?: false;
  /** @deprecated РСЃРїРѕР»СЊР·СѓР№ ingestParsePhaseSelection / CLI --phases. */
  pipelineOrder?: never;
  /** @deprecated РСЃРїРѕР»СЊР·СѓР№ ingestParsePhaseSelection / CLI --phases. */
  llmRuntimeOverride?: never;
  /**
   * IngestParseDaemon (scheduled ingestParse). Р”Р»СЏ one-shot CLI вЂ” false;
   * РґРѕРіРѕРЅ вЂ” РІ `worker:dev` / `parse-engine:ingest:drain`.
   */
  startIngestParseDaemon?: boolean;
};

export async function createWorkerCompositionRoot(
  options: WorkerCompositionOptions = {},
) {
  const storageMode = options.storageMode ?? resolveWorkerStorageModeFromEnv();
  const workerRole = options.workerRole ?? resolveWorkerRoleFromEnv();
  const hostStartedAt = new Date().toISOString();
  const deploymentManifest = loadDeploymentManifest({ repoRoot: MONOREPO_ROOT });
  const workerRuntime = loadWorkerRuntimeManifest({ repoRoot: MONOREPO_ROOT });
  const odp: OdpResolution[] = odpResolve(deploymentManifest);
  const runtimePipelines = resolveRuntimePipelines({
    manifest: deploymentManifest,
    workerRole,
  });

  const bus = new InProcessEventBus();
  let eventTransport!: IEventTransport;
  const parseAttemptLogger = new ParseAttemptLogger(workerRuntime.logging.verboseParse);
  const metricsAggregator = new MetricsAggregator();

  bus.subscribe("MessageParsed", parseAttemptLogger.handler);
  bus.subscribe("MessageParseFailed", parseAttemptLogger.handler);
  bus.subscribe("*", metricsAggregator.handler);

  let dataSource: DataSource | undefined;
  let ingestOrchestrator: IngestOrchestrator | undefined;
  let backfillDaemon: BackfillDaemonService | undefined;
  /** Pipeline launchers (legacy | runner-platform) РїРѕ deployment manifest. */
  let trackingRebuildDaemon: PipelineLauncher | undefined;
  let ingestParseDaemon: PipelineLauncher | undefined;
  let placeEnrichmentDaemon: PipelineLauncher | undefined;
  const pipelineLaunchers: PipelineLauncher[] = [];
  let phaseManualRunPoller: PhaseManualRunPoller | undefined;
  let phaseRunner: PhaseRunner | undefined;
  let coverageEnqueuer: CoverageEnqueuer | undefined;
  let teardownPhaseWake: (() => void) | undefined;
  let parseWorkerPool: ParseWorkerPool | undefined;
  let shutdown: (() => Promise<void>) | undefined;
  let observabilityRecorder: IObservabilityRecorder | undefined;
  let obsHostSnapshot: HostSnapshot | undefined;

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
    eventTransport = createEventTransport({
      transport: deploymentManifest.transport,
      workerRole,
      dataSource,
    });
    await eventTransport.start();
    if (deploymentManifest.transport.kind === "rmq") {
      const bridgeSuffix = { queueSuffix: resolveRmqConsumerSuffix(workerRole) };
      bridgeTransportTopicToBus(eventTransport, bus, RADAR_TOPICS.RAW_INGESTED, bridgeSuffix);
      bridgeTransportTopicToBus(eventTransport, bus, RADAR_TOPICS.MESSAGE_PARSED, bridgeSuffix);
    }
    const repos = await createWorkerDbRepositories(dataSource);
    workerRepos = repos;

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
    // РўРµС…РЅРёС‡РµСЃРєРёР№ СЃР»РµРґ РїР°СЂСЃРёРЅРіР° РІ Р‘Р” (log_parse_attempt) РґР»СЏ Р»РѕРіР°/Р°РіСЂРµРіР°С‚РѕРІ Р°РґРјРёРЅРєРё.
    const parseAttemptWriter = new ParseAttemptWriter(repos.parseAttempts);
    bus.subscribe("MessageParsed", parseAttemptWriter.handler);
    bus.subscribe("MessageParseFailed", parseAttemptWriter.handler);

    shutdown = async () => {
      teardownPhaseWake?.();
      phaseManualRunPoller?.stop();
      await ingestParseDaemon?.stop();
      await placeEnrichmentDaemon?.stop();
      await backfillDaemon?.stop();
      await trackingRebuildDaemon?.stop();
      await parseWorkerPool?.shutdown();
      await ingestOrchestrator?.stop();
      await eventTransport.stop();
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    };
  }

  const obsConfig = resolveObsConfig(deploymentManifest.infra.obs, storageMode);
  if (obsConfig.mode !== "noop") {
    observabilityRecorder = createObservabilityRecorder({
      mode: obsConfig.mode,
      serviceUrl: obsConfig.serviceUrl,
      dataSource: obsConfig.mode === "embedded" ? dataSource : undefined,
    });
  }

  /** obs_hosts РґРѕ workloads/executors вЂ” РёРЅР°С‡Рµ FK РЅР° СЃС‚Р°СЂС‚Рµ daemons/pool. */
  if (observabilityRecorder) {
    for (const entry of odp) {
      console.log(`[odp] ${entry.pipelineKey} в†’ ${entry.runtime} (${entry.label})`);
    }
    obsHostSnapshot = {
      hostId: buildObsHostId(workerRole),
      role: workerRole,
      startedAt: hostStartedAt,
      lastSeenAt: new Date().toISOString(),
      odpRuntime: odp.map((entry) => ({
        pipelineKey: entry.pipelineKey,
        label: entry.label,
        runtime: entry.runtime,
      })),
    };
    await observabilityRecorder.upsertHost(obsHostSnapshot);
  }

  const placeCache = options.placeCacheRepository ?? new InMemoryPlaceCacheRepository();
  const placeScan = options.placeScan ?? await createPlaceScanService({ places, regions });
  // CLI/test override вЂ” РЅРµ С‚СЏРЅРµРј places.listScanEntries (DB repo РёР· api/dist РјРѕР¶РµС‚ Р±С‹С‚СЊ СѓСЃС‚Р°СЂРµРІС€РёРј).
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

  if (storageMode === WorkerStorageMode.Db && workerRuntime.parse.useWorkerThreads) {
    const poolObs = observabilityRecorder
      ? createParseWorkerPoolObs({
          recorder: observabilityRecorder,
          hostId: buildObsHostId(workerRole),
        })
      : undefined;
    parseWorkerPool = new ParseWorkerPool(parsePipelineWorkerConfig, workerRuntime.parse.poolSize, poolObs);
  }

  const ingestEventPublisher: IngestEventPublisher =
    { transport: eventTransport };

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
    new TransportEventPublisher(eventTransport),
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
      events: new TransportEventPublisher(eventTransport),
      placeEnrichmentRunner,
    });
    coverageEnqueuer = new CoverageEnqueuer(
      workerRepos.phaseCoverage,
      workerRepos.phaseDefinitions,
    );
    wireTransportRuntimeSignals({
      transport: eventTransport,
      workerRepos,
      phaseRunner,
      coverageEnqueuer,
      workerRole,
    });
    teardownPhaseWake = await wirePhaseWakeScheduler({
      transport: eventTransport,
      phases: workerRepos.phaseDefinitions,
      onWake: (phase) => {
        const key = phase.scope === "ingestParse" ? "parse" : "geo-enrich";
        pipelineLaunchers.find((l) => l.pipelineKey === key)?.enqueue?.();
      },
    });
    if (roleSubscribesPhaseIngestOnBus(workerRole)) {
      eventTransport.subscribe(
        RADAR_TOPICS.RAW_INGESTED,
        createPhaseIngestHandler({
          rawMessages: workerRepos.rawMessages,
          phases: workerRepos.phaseDefinitions,
          runner: phaseRunner,
        }),
        { queueSuffix: "parse" },
      );
    }
    const startParseDaemons =
      roleRunsParseDaemons(workerRole) &&
      workerRuntime.parse.daemon.enabled &&
      options.startIngestParseDaemon !== false;
    if (dataSource) {
      const obsBinding = observabilityRecorder
        ? { recorder: observabilityRecorder, hostId: buildObsHostId(workerRole) }
        : undefined;
      const factoryDeps = {
        dataSource,
        workerRepos,
        phaseRunner,
        obsBinding,
        workerRuntime,
      };

      if (startParseDaemons) {
        const parseSpec = runtimePipelines.find((p) => p.entry.pipelineKey === "parse");
        if (parseSpec) {
          ingestParseDaemon = createPipelineLauncher(parseSpec, factoryDeps) ?? undefined;
          ingestParseDaemon?.start();
          if (ingestParseDaemon) pipelineLaunchers.push(ingestParseDaemon);
        }

        phaseManualRunPoller = new PhaseManualRunPoller(
          workerRepos.phaseDefinitions,
          workerRepos.phaseRuns,
          phaseRunner,
          workerRuntime.phase.manualPollMs,
        );
        phaseManualRunPoller.start();
      }

      if (roleRunsGeoDaemons(workerRole)) {
        const geoSpec = runtimePipelines.find((p) => p.entry.pipelineKey === "geo-enrich");
        if (geoSpec) {
          placeEnrichmentDaemon = createPipelineLauncher(geoSpec, factoryDeps) ?? undefined;
          placeEnrichmentDaemon?.start();
          if (placeEnrichmentDaemon) pipelineLaunchers.push(placeEnrichmentDaemon);
        }
      }
    }
  } else {
    eventTransport = createEventTransport({
      transport: deploymentManifest.transport,
      workerRole,
    });
    await eventTransport.start();
    eventTransport.subscribe(
      RADAR_TOPICS.RAW_INGESTED,
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
      workerRuntime.backfill.enabled
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
        workerRuntime.backfill.pollMs,
        workerRuntime.backfill.heartbeatMs,
      );
    }

    if (roleRunsTrackingDaemon(workerRole) && dataSource && workerRepos && workerRuntime.tracking.enabled) {
      const obsBinding = observabilityRecorder
        ? { recorder: observabilityRecorder, hostId: buildObsHostId(workerRole) }
        : undefined;
      const trackingSpec = runtimePipelines.find((p) => p.entry.pipelineKey === "tracking");
      if (trackingSpec) {
        trackingRebuildDaemon =
          createPipelineLauncher(trackingSpec, {
            dataSource,
            workerRepos,
            phaseRunner,
            obsBinding,
            workerRuntime,
          }) ?? undefined;
        trackingRebuildDaemon?.start();
        if (trackingRebuildDaemon) pipelineLaunchers.push(trackingRebuildDaemon);
      }
    }
  }

  // Wave 6: bus-trigger chaining вЂ” С‚РѕР»СЊРєРѕ runner-platform launchers СЃ enqueue.
  for (const launcher of pipelineLaunchers) {
    if (launcher.runtime !== "runner-platform" || !launcher.enqueue) continue;
    if (launcher.pipelineKey === "parse") {
      wireTransportTrigger(eventTransport, RADAR_TOPICS.RAW_INGESTED, {
        debounceMs: 250,
        onRoute: () => launcher.enqueue!(),
        queueSuffix: PIPELINE_RMQ_QUEUE_SUFFIX.parse,
        obs: observabilityRecorder
          ? {
              recorder: observabilityRecorder,
              pipelineKey: "parse",
              eventType: "RawMessageIngested",
            }
          : undefined,
      });
    }
    if (launcher.pipelineKey === "tracking") {
      wireTransportTrigger(eventTransport, RADAR_TOPICS.MESSAGE_PARSED, {
        debounceMs: 250,
        onRoute: () => launcher.enqueue!(),
        queueSuffix: PIPELINE_RMQ_QUEUE_SUFFIX.tracking,
        obs: observabilityRecorder
          ? {
              recorder: observabilityRecorder,
              pipelineKey: "tracking",
              eventType: "MessageParsed",
            }
          : undefined,
      });
    }
    if (launcher.pipelineKey === "geo-enrich") {
      wireTransportTrigger(eventTransport, RADAR_TOPICS.MESSAGE_PARSED, {
        debounceMs: 250,
        onRoute: () => launcher.enqueue!(),
        queueSuffix: PIPELINE_RMQ_QUEUE_SUFFIX["geo-enrich"],
        obs: observabilityRecorder
          ? {
              recorder: observabilityRecorder,
              pipelineKey: "geo-enrich",
              eventType: "MessageParsed",
            }
          : undefined,
      });
    }
  }

  return {
    storageMode,
    workerRole,
    bus,
    odp,
    observabilityRecorder,
    obsHostSnapshot,
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
    ingestParseDaemon,
    placeEnrichmentDaemon,
    placeEnrichmentRunner,
    phaseRunner,
    coverageEnqueuer,
    workerRepos,
    dataSource,
    shutdown,
  };
}


