/**
 * ---
 * layer: worker/composition
 * domain: transport/runtime
 * purpose: Владеет всеми transport-подписками и их lifecycle worker.
 *          Domain handlers планируют работу; StepTriggerRouter будит шаги по манифесту.
 * ---
 */
import type {
  IEventTransport,
  IObservabilityRecorder,
  IPhaseDefinitionRepository,
  PipelineManifest,
  StepRunContext,
} from "@radar/shared";
import {
  PIPELINE_RMQ_QUEUE_SUFFIX,
  RADAR_TOPICS,
  pipelineKeySchema,
  type PipelineKey,
} from "@radar/shared";
import { bridgeTransportTopicToBus } from "../../infrastructure/transport/bridgeTransportToBus.js";
import {
  wireTransportRuntimeSignals,
  type WireTransportRuntimeSignalsInput,
} from "../../infrastructure/transport/wireTransportRuntimeSignals.js";
import { wirePhaseWakeScheduler } from "../../application/phases/phaseWakeScheduler.js";
import { wireStepTriggerRouter } from "../../application/runtime/step/stepTriggerRouter.js";
import {
  hasCap,
  type DomainCap,
} from "../../infrastructure/config/workerRole.js";
import type { InProcessEventBus } from "../../infrastructure/events/inProcessEventBus.js";
import type { WorkerLifecycle } from "../lifecycle/WorkerLifecycle.js";
import type { PipelineWakePort } from "../runtime/PipelineLauncherRegistry.js";

type TransportHandler = Parameters<IEventTransport["subscribe"]>[1];

type RuntimeSignals = Omit<WireTransportRuntimeSignalsInput, "transport">;

export type WireWorkerTransportSubscriptionsInput = {
  transport: IEventTransport;
  lifecycle: WorkerLifecycle;
  caps: ReadonlySet<DomainCap>;
  wake: PipelineWakePort;
  hasWakeableLauncher: (pipelineKey: PipelineKey) => boolean;
  observabilityRecorder?: IObservabilityRecorder;
  bridgeToBus?: InProcessEventBus;
  bridgeQueueSuffix?: string;
  runtimeSignals?: RuntimeSignals;
  phaseWake?: {
    phases: IPhaseDefinitionRepository;
  };
  parseIngestHandler?: TransportHandler;
  createGeoIngestHandler?: () => Promise<TransportHandler>;
  /** bfend → parse forward (снять флаг + wake). */
  channelBackfillCompletedHandler?: TransportHandler;
  trackingIntervalMs?: number;
  rawMessageIngestedHandler?: TransportHandler;
  /** Declarative step ingress (Wave 2). */
  pipelineManifest?: PipelineManifest;
};

/**
 * Регистрирует подписки в порядке обработки: domain handler планирует работу,
 * затем StepTriggerRouter будит соответствующие pipeline steps.
 */
export async function wireWorkerTransportSubscriptions(
  input: WireWorkerTransportSubscriptionsInput,
): Promise<void> {
  const {
    transport,
    lifecycle,
    caps,
    wake,
    hasWakeableLauncher,
    observabilityRecorder,
    bridgeToBus,
    bridgeQueueSuffix,
    runtimeSignals,
    phaseWake,
    parseIngestHandler,
    createGeoIngestHandler,
    channelBackfillCompletedHandler,
    trackingIntervalMs,
    rawMessageIngestedHandler,
    pipelineManifest,
  } = input;

  if (bridgeToBus) {
    const bridgeOptions = { queueSuffix: bridgeQueueSuffix };
    lifecycle.register(
      bridgeTransportTopicToBus(
        transport,
        bridgeToBus,
        RADAR_TOPICS.RAW_INGESTED,
        bridgeOptions,
      ),
    );
    lifecycle.register(
      bridgeTransportTopicToBus(
        transport,
        bridgeToBus,
        RADAR_TOPICS.MESSAGE_PARSED,
        bridgeOptions,
      ),
    );
  }

  if (runtimeSignals) {
    lifecycle.register(wireTransportRuntimeSignals({ transport, ...runtimeSignals }));
  }

  if (phaseWake) {
    lifecycle.register(
      await wirePhaseWakeScheduler({
        transport,
        phases: phaseWake.phases,
        onWake: (phase) => {
          wake.wake(phase.scope === "ingestParse" ? "parse" : "geo-enrich");
        },
      }),
    );
  }

  if (hasCap(caps, "parse") && parseIngestHandler) {
    lifecycle.register(
      transport.subscribe(RADAR_TOPICS.RAW_INGESTED, parseIngestHandler, {
        queueSuffix: "parse",
      }),
    );
  }

  if (hasCap(caps, "geo") && createGeoIngestHandler) {
    lifecycle.register(
      transport.subscribe(
        RADAR_TOPICS.MESSAGE_PARSED,
        await createGeoIngestHandler(),
        { queueSuffix: PIPELINE_RMQ_QUEUE_SUFFIX["geo-enrich"] },
      ),
    );
  }

  if (hasCap(caps, "parse") && channelBackfillCompletedHandler) {
    lifecycle.register(
      transport.subscribe(
        RADAR_TOPICS.CHANNEL_BACKFILL_COMPLETED,
        channelBackfillCompletedHandler,
        { queueSuffix: PIPELINE_RMQ_QUEUE_SUFFIX.parse },
      ),
    );
  }

  if (hasCap(caps, "tracking") && trackingIntervalMs != null) {
    const timer = setInterval(() => wake.wake("tracking"), trackingIntervalMs);
    lifecycle.register(() => clearInterval(timer));
  }

  if (rawMessageIngestedHandler) {
    lifecycle.register(
      transport.subscribe(RADAR_TOPICS.RAW_INGESTED, rawMessageIngestedHandler),
    );
  }

  if (pipelineManifest) {
    wireStepTriggers({
      transport,
      lifecycle,
      wake,
      hasWakeableLauncher,
      observabilityRecorder,
      pipelineManifest,
    });
  }
}

type WireStepTriggersInput = Pick<
  WireWorkerTransportSubscriptionsInput,
  | "transport"
  | "lifecycle"
  | "wake"
  | "hasWakeableLauncher"
  | "observabilityRecorder"
  | "pipelineManifest"
> & { pipelineManifest: PipelineManifest };

/**
 * Manifest-driven ingress: topic → gates → debounced StepRunContext → wake(pipelineKey).
 * Domain subscribers выше остаются для planning (enqueue coverage/jobs).
 */
function wireStepTriggers(input: WireStepTriggersInput): void {
  const stepsById = new Map(
    input.pipelineManifest.steps.filter((s) => s.enabled).map((s) => [s.id, s]),
  );

  input.lifecycle.register(
    wireStepTriggerRouter({
      steps: input.pipelineManifest.steps,
      transport: input.transport,
      onStepTrigger: (ctx: StepRunContext) => {
        const step = stepsById.get(ctx.stepId);
        if (!step) return;
        const parsed = pipelineKeySchema.safeParse(step.pipelineKey);
        if (!parsed.success) return;
        const pipelineKey = parsed.data;
        if (!input.hasWakeableLauncher(pipelineKey)) return;

        if (input.observabilityRecorder) {
          void input.observabilityRecorder
            .incrementTrigger(
              {
                pipelineKey,
                eventType: ctx.trigger.topic || "step.trigger",
                source: ctx.trigger.source,
              },
              1,
            )
            .catch((err: unknown) => {
              console.warn("[obs] incrementTrigger failed:", err);
            });
        }

        input.wake.wake(pipelineKey);
      },
    }),
  );
}
