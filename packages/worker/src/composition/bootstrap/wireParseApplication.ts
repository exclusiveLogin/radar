/**
 * ---
 * layer: worker/composition
 * domain: parse
 * purpose: Собирает parse application и опциональный worker pool.
 * ---
 */
import type { IObservabilityRecorder } from "@radar/shared";
import { MONOREPO_ROOT } from "@repo/root";
import type { WorkerCompositionOptions } from "../../application/workerCompositionRoot.types.js";
import { ParseRawMessageHandler } from "../../application/handlers/parseRawMessageHandler.js";
import { GeoValidationService } from "../../application/parse/geoValidationService.js";
import {
  loadAllIngestParsePhases,
  loadIngestParsePhases,
  selectIngestParsePhases,
} from "../../application/parse/loadIngestParsePhases.js";
import { createParsePipeline } from "../../application/parse/createParsePipeline.js";
import type { ParsePipelineWorkerConfig } from "../../application/parse/createParsePipeline.js";
import { ParseWorkerPool } from "../../application/parse/parseWorkerPool.js";
import { createParseWorkspaceMessageService } from "../../application/parse/createParseWorkspaceMessageService.js";
import { createParseExternalEnricher } from "./createParseExternalEnricher.js";
import { createParseWorkerPoolObs } from "../../application/runtime/observability/parseWorkerPoolObs.js";
import { createPlaceScanService } from "../../infrastructure/place-scan/createPlaceScanService.js";
import { TransportEventPublisher } from "../../infrastructure/transport/transportEventPublisher.js";
import { WorkerStorageMode } from "../../infrastructure/persistence/storageMode.js";
import { buildObsHostId } from "../../infrastructure/config/obsMode.js";
import type { resolveWorkerBootstrapContext } from "./resolveWorkerBootstrapContext.js";
import type { createWorkerPersistence } from "./createWorkerPersistence.js";

type BootstrapContext = ReturnType<typeof resolveWorkerBootstrapContext>;
type WorkerPersistence = Awaited<ReturnType<typeof createWorkerPersistence>>;

/** Создаёт parse stack только для parse/geo caps. */
export async function wireParseApplication(
  options: WorkerCompositionOptions,
  context: Pick<
    BootstrapContext,
    "needsParseStack" | "storageMode" | "workerRole" | "workerRuntime" | "lifecycle"
  >,
  persistence: Pick<
    WorkerPersistence,
    | "dataSource"
    | "eventTransport"
    | "workerRepos"
    | "parsedEvents"
    | "messageParseWorkspaces"
    | "eventLocations"
    | "eventEvidence"
    | "regions"
    | "places"
    | "aliases"
  >,
  observabilityRecorder: IObservabilityRecorder | undefined,
) {
  if (!context.needsParseStack) {
    console.log(`[caps] skip parse stack (placeScan/listScanEntries/pipeline) role=${context.workerRole}`);
    return {
      placeScan: options.placeScan,
      ingestParsePhases: [],
      pipeline: undefined,
      validation: undefined,
      workspaceService: undefined,
      parseRawMessageHandler: undefined,
      parseWorkerPool: undefined,
    };
  }

  const placeScan =
    options.placeScan ??
    (await createPlaceScanService({
      places: persistence.places,
      regions: persistence.regions,
    }));
  const placeScanEntries =
    options.placeScan != null ? [] : await persistence.places.listScanEntries();
  const phaseDefinitions = persistence.workerRepos?.phaseDefinitions;
  const phaseSelection = options.ingestParsePhaseSelection ?? { kind: "manifest" };
  const ingestParsePhases =
    phaseSelection.kind === "manifest"
      ? await loadIngestParsePhases({ repoRoot: MONOREPO_ROOT, phaseDefinitions })
      : selectIngestParsePhases(
          await loadAllIngestParsePhases({ repoRoot: MONOREPO_ROOT, phaseDefinitions }),
          phaseSelection,
        );
  const parsePipelineWorkerConfig: ParsePipelineWorkerConfig = {
    ingestParsePhases,
    placeScanEntries,
    placeScanRevision: placeScan.revision(),
  };
  const pipeline = createParsePipeline({
    placeScan,
    regions: persistence.regions,
    ingestParsePhases,
    places: persistence.places,
  }).pipeline;
  const validation = new GeoValidationService(
    persistence.regions,
    persistence.places,
    persistence.aliases,
  );
  const parseWorkerPool =
    context.storageMode === WorkerStorageMode.Db &&
    context.workerRuntime.parse.useWorkerThreads
      ? new ParseWorkerPool(
          parsePipelineWorkerConfig,
          context.workerRuntime.parse.poolSize,
          observabilityRecorder
            ? createParseWorkerPoolObs({
                recorder: observabilityRecorder,
                hostId: buildObsHostId(context.workerRole),
              })
            : undefined,
        )
      : undefined;

  if (parseWorkerPool) context.lifecycle.register(() => parseWorkerPool.shutdown());

  const workspaceService = createParseWorkspaceMessageService({
    placeScan,
    regions: persistence.regions,
    places: persistence.places,
    validation,
    parsedEvents: persistence.parsedEvents,
    eventLocations: persistence.eventLocations,
    messageParseWorkspaces: persistence.messageParseWorkspaces,
    externalEnricher: createParseExternalEnricher(),
  });
  const parseRawMessageHandler = new ParseRawMessageHandler(
    workspaceService,
    persistence.parsedEvents,
    persistence.eventLocations,
    persistence.eventEvidence,
    new TransportEventPublisher(persistence.eventTransport),
  );

  return {
    placeScan,
    ingestParsePhases,
    pipeline,
    validation,
    workspaceService,
    parseRawMessageHandler,
    parseWorkerPool,
  };
}
