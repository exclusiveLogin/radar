import type {
  HostSnapshot,
  IEventTransport,
  IObservabilityRecorder,
  IPlaceCacheRepository,
  IPlaceScanPort,
  PhaseDefinitionRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import type { OdpResolution } from "../composition/odp/index.js";
import type { PipelineLauncher } from "../composition/runtime/index.js";
import type { DomainCap, WorkerRole } from "../infrastructure/config/workerRole.js";
import type { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import type { WorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.types.js";
import type { InProcessEventBus } from "../infrastructure/events/inProcessEventBus.js";
import type { PlaceEnrichmentRunner } from "./geo-parse/placeEnrichmentRunner.js";
import type { IngestRawMessageHandler } from "./handlers/ingestRawMessageHandler.js";
import type { ParseRawMessageHandler } from "./handlers/parseRawMessageHandler.js";
import type { BackfillDaemonService } from "./ingest/backfillDaemonService.js";
import type { IngestOrchestrator } from "./ingest/ingestOrchestrator.js";
import type { CoverageEnqueuer } from "./phases/coverageEnqueuer.js";
import type { PhaseRunSession } from "./phases/phaseRunSession.js";
import type { PhaseRunner } from "./phases/phaseRunner.js";
import type { OperationalSql } from "./phases/operationalSql.port.js";
import type { IngestParsePhaseSelection } from "./parse/loadIngestParsePhases.js";
import type { ParsePhaseTool } from "./parse/parsePhaseTool.js";
import type { ParsePipelineService } from "./parse/parsePipelineService.js";
import type { ParseWorkerPool } from "./parse/parseWorkerPool.js";
import type { ParseWorkspaceMessageService } from "./parse/ParseWorkspaceMessageService.js";
import type { PhasePlatformDeps } from "./runtime/runner-platform/phasePlatformDeps.js";
import type { MetricsAggregator } from "./subscribers/index.js";

/** Опции bootstrap worker runtime. */
export type WorkerCompositionOptions = {
  storageMode?: WorkerStorageMode;
  /** Роль процесса; default — env RADAR_WORKER_ROLE. */
  workerRole?: WorkerRole;
  /** Опциональные domain caps для CLI (мультидоменный tooling). */
  bootCaps?: DomainCap[];
  placeCacheRepository?: IPlaceCacheRepository;
  /** Override DB-backed geo scan (tests / offline CLI). */
  placeScan?: IPlaceScanPort;
  /**
   * Override ingestParse-фаз для offline CLI (snap/report).
   * Default / `{ kind: "manifest" }` — enabled из DB / pipeline.manifest.phases.
   */
  ingestParsePhaseSelection?: IngestParsePhaseSelection;
  /**
   * IngestParseDaemon (scheduled ingestParse). Для one-shot CLI — false;
   * догон — в `worker:dev` / `parse-engine:ingest:drain`.
   */
  startIngestParseDaemon?: boolean;
};

/** Стабильная runtime facade для worker CLI и entrypoints. */
export type WorkerCompositionRoot = {
  storageMode: WorkerStorageMode;
  workerRole: WorkerRole;
  bus: InProcessEventBus;
  odp: OdpResolution[];
  observabilityRecorder: IObservabilityRecorder | undefined;
  obsHostSnapshot: HostSnapshot | undefined;
  metricsAggregator: MetricsAggregator;
  placeScan: IPlaceScanPort | undefined;
  parsePipelineService: ParsePipelineService | undefined;
  ingestParsePhases: PhaseDefinitionRecord[];
  parseWorkerPool: ParseWorkerPool | undefined;
  workspaceService: ParseWorkspaceMessageService | undefined;
  ingestRawMessageHandler: IngestRawMessageHandler | undefined;
  parseRawMessageHandler: ParseRawMessageHandler | undefined;
  ingestOrchestrator: IngestOrchestrator | undefined;
  backfillDaemon: BackfillDaemonService | undefined;
  trackingLauncher: PipelineLauncher | undefined;
  ingestParseDaemon: PipelineLauncher | undefined;
  placeEnrichmentDaemon: PipelineLauncher | undefined;
  placeEnrichmentRunner: PlaceEnrichmentRunner | undefined;
  phaseRunner: PhaseRunner | undefined;
  parseTool: ParsePhaseTool | undefined;
  phaseRunSession: PhaseRunSession | undefined;
  phasePlatform: PhasePlatformDeps | undefined;
  coverageEnqueuer: CoverageEnqueuer | undefined;
  workerRepos: WorkerDbRepositories | undefined;
  operationalSql: OperationalSql | undefined;
  dataSource: DataSource | undefined;
  eventTransport: IEventTransport | undefined;
  shutdown: (() => Promise<void>) | undefined;
};
