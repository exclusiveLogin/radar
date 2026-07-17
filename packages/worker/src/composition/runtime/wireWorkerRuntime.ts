/**
 * ---
 * layer: worker/composition
 * domain: runtime
 * purpose: Запускает domain runtime и связывает его с transport lifecycle.
 * ---
 */
import { resolveGeoEnrichmentProvider, resolveRmqConsumerSuffix } from "@radar/shared";
import { bootBackfill } from "../../domain-boots/bootBackfill.js";
import { bootGeo } from "../../domain-boots/bootGeo.js";
import { bootIngest } from "../../domain-boots/bootIngest.js";
import { bootTracking } from "../../domain-boots/bootTracking.js";
import { createRawMessageIngestedHandler } from "../../application/subscribers/rawMessageIngestedSubscriber.js";
import { createPhaseIngestHandler } from "../../application/subscribers/phaseIngestSubscriber.js";
import { IngestRawMessageHandler } from "../../application/handlers/ingestRawMessageHandler.js";
import { PhaseManualRunPoller } from "../../application/phases/phaseManualRunPoller.js";
import { runGeoPhaseDrain } from "../../application/geo-parse/runGeoPhaseDrain.js";
import { SessionResolver } from "../../application/sessions/sessionResolver.js";
import {
  resolveTelegramAppCredentials,
  toTelegramMtprotoAppCredentials,
} from "../../infrastructure/telegram/telegramAppCredentials.js";
import { hasCap } from "../../infrastructure/config/workerRole.js";
import { buildObsHostId } from "../../infrastructure/config/obsMode.js";
import { WorkerStorageMode } from "../../infrastructure/persistence/storageMode.js";
import type {
  WorkerCompositionOptions,
  WorkerCompositionRoot,
} from "../../application/workerCompositionRoot.types.js";
import type { createWorkerPersistence } from "../bootstrap/createWorkerPersistence.js";
import type { createWorkerObservability } from "../bootstrap/createWorkerObservability.js";
import type { resolveWorkerBootstrapContext } from "../bootstrap/resolveWorkerBootstrapContext.js";
import type { wireParseApplication } from "../bootstrap/wireParseApplication.js";
import type { wirePhasePlatform } from "../bootstrap/wirePhasePlatform.js";
import { wireWorkerTransportSubscriptions } from "../transport/wireWorkerTransportSubscriptions.js";
import { startWorkerPipelines } from "./startWorkerPipelines.js";

type BootstrapContext = ReturnType<typeof resolveWorkerBootstrapContext>;
type WorkerPersistence = Awaited<ReturnType<typeof createWorkerPersistence>>;
type WorkerObservability = Awaited<ReturnType<typeof createWorkerObservability>>;
type ParseApplication = Awaited<ReturnType<typeof wireParseApplication>>;
type PhaseApplication = Awaited<ReturnType<typeof wirePhasePlatform>>;

export type WorkerRuntime = Pick<
  WorkerCompositionRoot,
  | "ingestRawMessageHandler"
  | "ingestOrchestrator"
  | "backfillDaemon"
  | "trackingLauncher"
  | "ingestParseDaemon"
  | "placeEnrichmentDaemon"
>;

export type WireWorkerRuntimeInput = {
  options: WorkerCompositionOptions;
  context: BootstrapContext;
  persistence: WorkerPersistence;
  observability: WorkerObservability;
  parseApplication: ParseApplication;
  phaseApplication: PhaseApplication;
};

/** Запускает разрешённые caps и регистрирует их transport/lifecycle ownership. */
export async function wireWorkerRuntime(
  input: WireWorkerRuntimeInput,
): Promise<WorkerRuntime> {
  const {
    options,
    context,
    persistence,
    observability,
    parseApplication,
    phaseApplication,
  } = input;
  const {
    dataSource,
    workerRepos,
    eventTransport,
    ingestProviders,
    ingestBindings,
    channels,
    backfillJobs,
    cursors,
  } = persistence;
  const {
    coverageEnqueuer,
    phasePlatform,
    phaseRunSession,
    phaseRunner,
    placeEnrichmentRunner,
  } = phaseApplication;
  const ingestRawMessageHandler = context.needsIngestPath
    ? new IngestRawMessageHandler(
        persistence.rawMessages,
        { transport: eventTransport },
        persistence.cursors,
      )
    : undefined;
  let ingestParseDaemon: WorkerRuntime["ingestParseDaemon"];
  let placeEnrichmentDaemon: WorkerRuntime["placeEnrichmentDaemon"];
  let trackingLauncher: WorkerRuntime["trackingLauncher"];
  let phaseManualRunPoller: PhaseManualRunPoller | undefined;
  const factoryDeps = dataSource
    ? {
        dataSource,
        phasePlatform,
        obsBinding: observability.observabilityRecorder
          ? {
              recorder: observability.observabilityRecorder,
              hostId: buildObsHostId(context.workerRole),
            }
          : undefined,
        workerRuntime: context.workerRuntime,
      }
    : undefined;

  if (workerRepos && factoryDeps) {
    const startParseDaemons =
      hasCap(context.caps, "parse") &&
      context.workerRuntime.parse.daemon.enabled &&
      options.startIngestParseDaemon !== false;

    if (startParseDaemons) {
      if (!phaseRunner || !phasePlatform?.parseTool) {
        throw new Error("parseTool/PhaseRunner не сконфигурирован для parse boot.");
      }
      ingestParseDaemon = startWorkerPipelines({
        runtimePipelines: context.runtimePipelines,
        pipelineKeys: ["parse"],
        factoryDeps,
        launchers: context.pipelineLaunchers,
        lifecycle: context.lifecycle,
      }).parse;
      if (ingestParseDaemon && coverageEnqueuer) {
        void coverageEnqueuer.catchUpPhase("catalog").then(() => {
          context.pipelineLaunchers.wake("parse");
        });
      }

      phaseManualRunPoller = new PhaseManualRunPoller(
        workerRepos.phaseDefinitions,
        workerRepos.phaseRuns,
        {
          runDrain: async (input) => {
            if (input.phase.scope !== "geoParse") return phaseRunner.runDrain(input);
            if (!placeEnrichmentRunner || !phaseRunSession) {
              throw new Error("geo drain: placeEnrichmentRunner/session missing");
            }
            return runGeoPhaseDrain(
              {
                placeEnrichmentRunner,
                placeEnrichmentJobs: workerRepos.placeEnrichmentJobs,
                session: phaseRunSession,
              },
              input,
            );
          },
        },
        context.workerRuntime.phase.manualPollMs,
      );
      phaseManualRunPoller.start();
      context.lifecycle.register(() => phaseManualRunPoller?.stop());
    }

    if (hasCap(context.caps, "geo")) {
      placeEnrichmentDaemon = startWorkerPipelines({
        runtimePipelines: context.runtimePipelines,
        pipelineKeys: ["geo-enrich"],
        factoryDeps,
        launchers: context.pipelineLaunchers,
        lifecycle: context.lifecycle,
      })["geo-enrich"];
    }
  }

  let ingestOrchestrator: WorkerRuntime["ingestOrchestrator"];
  let backfillDaemon: WorkerRuntime["backfillDaemon"];
  if (
    context.storageMode === WorkerStorageMode.Db &&
    ingestProviders &&
    ingestBindings &&
    channels
  ) {
    const sessionResolver = new SessionResolver();
    const telegramMtprotoApp = toTelegramMtprotoAppCredentials(
      resolveTelegramAppCredentials(),
    );

    if (hasCap(context.caps, "ingest") && ingestRawMessageHandler) {
      ingestOrchestrator = await bootIngest(
        ({ IngestOrchestrator: Orchestrator }) =>
          new Orchestrator(
            ingestProviders,
            ingestBindings,
            channels,
            ingestRawMessageHandler,
            context.bus,
            sessionResolver,
            telegramMtprotoApp,
          ),
      );
      context.lifecycle.register(() => ingestOrchestrator?.stop());
    }

    if (
      hasCap(context.caps, "backfill") &&
      backfillJobs &&
      cursors &&
      context.workerRuntime.backfill.enabled &&
      ingestRawMessageHandler
    ) {
      backfillDaemon = await bootBackfill(
        ({ BackfillDaemonService: Daemon }) =>
          new Daemon(
            backfillJobs,
            ingestProviders,
            ingestBindings,
            channels,
            cursors,
            ingestRawMessageHandler,
            sessionResolver,
            telegramMtprotoApp,
            context.workerRuntime.backfill.pollMs,
            context.workerRuntime.backfill.heartbeatMs,
          ),
      );
      context.lifecycle.register(() => backfillDaemon?.stop());
    }

    if (
      hasCap(context.caps, "tracking") &&
      factoryDeps &&
      context.workerRuntime.tracking.enabled
    ) {
      trackingLauncher = startWorkerPipelines({
        runtimePipelines: context.runtimePipelines,
        pipelineKeys: ["tracking"],
        factoryDeps,
        launchers: context.pipelineLaunchers,
        lifecycle: context.lifecycle,
      }).tracking;
    }
  }

  await wireWorkerTransportSubscriptions({
    transport: eventTransport,
    lifecycle: context.lifecycle,
    caps: context.caps,
    wake: context.pipelineLaunchers,
    hasWakeableLauncher: (pipelineKey) =>
      context.pipelineLaunchers.hasWakeable(pipelineKey),
    observabilityRecorder: observability.observabilityRecorder,
    bridgeToBus:
      context.storageMode === WorkerStorageMode.Db &&
      context.deploymentManifest.transport.kind === "rmq" &&
      context.needsParseStack
        ? context.bus
        : undefined,
    bridgeQueueSuffix: resolveRmqConsumerSuffix(context.workerRole),
    runtimeSignals: workerRepos
      ? {
          caps: context.caps,
          setPhaseEnabled: (phaseKey, enabled) =>
            workerRepos.phaseDefinitions.setEnabled(phaseKey, enabled),
          findPhase: (phaseKey) => workerRepos.phaseDefinitions.findById(phaseKey),
          prepareParseDrain: coverageEnqueuer
            ? async ({ phase, mode, ids, catchUp }) => {
                if (mode === "targeted" && ids?.length) {
                  await coverageEnqueuer.planPendingForIds(ids);
                } else if (catchUp === true) {
                  await coverageEnqueuer.catchUpPhase(phase.id);
                }
              }
            : undefined,
          prepareGeoEnrich: placeEnrichmentRunner
            ? async ({ phase, placeIds }) => {
                const provider = resolveGeoEnrichmentProvider(phase);
                if (!provider || !placeIds?.length) return;
                for (const placeId of placeIds) {
                  await workerRepos.placeEnrichmentJobs.enqueue(placeId, provider);
                }
              }
            : undefined,
          onParseWake: () => context.pipelineLaunchers.wake("parse"),
          onGeoWake: () => context.pipelineLaunchers.wake("geo-enrich"),
          onTrackingWake: () => context.pipelineLaunchers.wake("tracking"),
        }
      : undefined,
    phaseWake:
      workerRepos && context.needsParseStack
        ? { phases: workerRepos.phaseDefinitions }
        : undefined,
    parseIngestHandler:
      workerRepos && hasCap(context.caps, "parse") && coverageEnqueuer
        ? createPhaseIngestHandler({
            rawMessages: workerRepos.rawMessages,
            coverageEnqueuer,
            onWake: () => context.pipelineLaunchers.wake("parse"),
          })
        : undefined,
    createGeoIngestHandler:
      workerRepos && hasCap(context.caps, "geo")
        ? () =>
            bootGeo(({ subscriber }) =>
              subscriber.createGeoPlaceIngestHandler({
                phases: workerRepos.phaseDefinitions,
                placeJobs: workerRepos.placeEnrichmentJobs,
                onWake: () => context.pipelineLaunchers.wake("geo-enrich"),
              }),
            )
        : undefined,
    createTrackingIngestHandler: hasCap(context.caps, "tracking")
      ? () =>
          bootTracking(({ subscriber }) =>
            subscriber.createTrackingIngestHandler({
              onWake: () => context.pipelineLaunchers.wake("tracking"),
            }),
          )
      : undefined,
    trackingIntervalMs: hasCap(context.caps, "tracking")
      ? context.workerRuntime.tracking.intervalMs
      : undefined,
    rawMessageIngestedHandler:
      context.storageMode !== WorkerStorageMode.Db && parseApplication.parseRawMessageHandler
        ? createRawMessageIngestedHandler({
            rawMessages: persistence.rawMessages,
            parseHandler: parseApplication.parseRawMessageHandler,
          })
        : undefined,
  });

  return {
    ingestRawMessageHandler,
    ingestOrchestrator,
    backfillDaemon,
    trackingLauncher,
    ingestParseDaemon,
    placeEnrichmentDaemon,
  };
}
