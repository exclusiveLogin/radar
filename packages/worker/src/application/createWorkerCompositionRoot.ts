/**
 * Composition root worker: упорядочивает bootstrap slices и связывает их на границе runtime.
 * @see ../../../../docs/domain/how-it-works.md#composition-root-flow
 */
import { resolveWorkerBootstrapContext } from "../composition/bootstrap/resolveWorkerBootstrapContext.js";
import { createWorkerPersistence } from "../composition/bootstrap/createWorkerPersistence.js";
import { createWorkerObservability } from "../composition/bootstrap/createWorkerObservability.js";
import { wireParseApplication } from "../composition/bootstrap/wireParseApplication.js";
import { wirePhasePlatform } from "../composition/bootstrap/wirePhasePlatform.js";
import { wireWorkerRuntime } from "../composition/runtime/wireWorkerRuntime.js";
import type {
  WorkerCompositionOptions,
  WorkerCompositionRoot,
} from "./workerCompositionRoot.types.js";

export type { WorkerCompositionOptions, WorkerCompositionRoot } from "./workerCompositionRoot.types.js";

/** Собирает worker runtime, сохраняя стабильную facade для CLI. */
export async function createWorkerCompositionRoot(
  options: WorkerCompositionOptions = {},
): Promise<WorkerCompositionRoot> {
  const context = resolveWorkerBootstrapContext(options);
  const persistence = await createWorkerPersistence(context);
  const { observabilityRecorder, obsHostSnapshot } = await createWorkerObservability(
    context,
    persistence,
  );
  const parseApplication = await wireParseApplication(
    options,
    context,
    persistence,
    observabilityRecorder,
  );
  const phaseApplication = await wirePhasePlatform(
    context,
    persistence.workerRepos,
    parseApplication,
    persistence.eventTransport,
  );

  const runtime = await wireWorkerRuntime({
    options,
    context,
    persistence,
    observability: { observabilityRecorder, obsHostSnapshot },
    parseApplication,
    phaseApplication,
  });

  return {
    storageMode: context.storageMode,
    workerRole: context.workerRole,
    bus: context.bus,
    odp: context.odp,
    observabilityRecorder,
    obsHostSnapshot,
    metricsAggregator: context.metricsAggregator,
    placeScan: parseApplication.placeScan,
    parsePipelineService: parseApplication.pipeline,
    ingestParsePhases: parseApplication.ingestParsePhases,
    parseWorkerPool: parseApplication.parseWorkerPool,
    workspaceService: parseApplication.workspaceService,
    ingestRawMessageHandler: runtime.ingestRawMessageHandler,
    parseRawMessageHandler: parseApplication.parseRawMessageHandler,
    ingestOrchestrator: runtime.ingestOrchestrator,
    backfillDaemon: runtime.backfillDaemon,
    trackingLauncher: runtime.trackingLauncher,
    ingestParseDaemon: runtime.ingestParseDaemon,
    placeEnrichmentDaemon: runtime.placeEnrichmentDaemon,
    placeEnrichmentRunner: phaseApplication.placeEnrichmentRunner,
    phaseRunner: phaseApplication.phaseRunner,
    parseTool: phaseApplication.parseTool,
    phaseRunSession: phaseApplication.phaseRunSession,
    phasePlatform: phaseApplication.phasePlatform,
    coverageEnqueuer: phaseApplication.coverageEnqueuer,
    workerRepos: persistence.workerRepos,
    dataSource: persistence.dataSource,
    shutdown: persistence.shutdown,
  };
}
