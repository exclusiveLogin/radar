/**
 * ---
 * layer: worker/composition
 * domain: transport/runtime
 * purpose: Владеет всеми transport-подписками и их lifecycle worker.
 * ---
 */
import type {
  IEventTransport,
  IObservabilityRecorder,
  IPhaseDefinitionRepository,
} from "@radar/shared";
import {
  PIPELINE_RMQ_QUEUE_SUFFIX,
  RADAR_TOPICS,
  type PipelineKey,
} from "@radar/shared";
import { bridgeTransportTopicToBus } from "../../infrastructure/transport/bridgeTransportToBus.js";
import {
  wireTransportRuntimeSignals,
  type WireTransportRuntimeSignalsInput,
} from "../../infrastructure/transport/wireTransportRuntimeSignals.js";
import { wirePhaseWakeScheduler } from "../../application/phases/phaseWakeScheduler.js";
import { wireTransportTrigger } from "../../application/runtime/workload/wireTransportTrigger.js";
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
  trackingIntervalMs?: number;
  rawMessageIngestedHandler?: TransportHandler;
};

/**
 * Регистрирует подписки в порядке обработки: domain handler планирует работу,
 * затем отдельный debounce-trigger будит соответствующий pipeline.
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
    trackingIntervalMs,
    rawMessageIngestedHandler,
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

  if (hasCap(caps, "tracking") && trackingIntervalMs != null) {
    const timer = setInterval(() => wake.wake("tracking"), trackingIntervalMs);
    lifecycle.register(() => clearInterval(timer));
  }

  if (rawMessageIngestedHandler) {
    lifecycle.register(
      transport.subscribe(RADAR_TOPICS.RAW_INGESTED, rawMessageIngestedHandler),
    );
  }

  wireTrackingTrigger({
    transport,
    lifecycle,
    wake,
    hasWakeableLauncher,
    observabilityRecorder,
  });
}

type WireRunnerTriggersInput = Pick<
  WireWorkerTransportSubscriptionsInput,
  "transport" | "lifecycle" | "wake" | "hasWakeableLauncher" | "observabilityRecorder"
>;

/**
 * MessageParsed только будит tracking: данные runner читает из PostgreSQL.
 * Эфемерная noAck-очередь не накапливает одинаковые wake-сообщения без worker.
 */
function wireTrackingTrigger(input: WireRunnerTriggersInput): void {
  const pipelineKey: PipelineKey = "tracking";
  if (!input.hasWakeableLauncher(pipelineKey)) return;

  input.lifecycle.register(
    wireTransportTrigger(input.transport, RADAR_TOPICS.MESSAGE_PARSED, {
      debounceMs: 250,
      onRoute: () => input.wake.wake(pipelineKey),
      queueSuffix: `${PIPELINE_RMQ_QUEUE_SUFFIX[pipelineKey]}.trigger`,
      delivery: "transient",
      obs: input.observabilityRecorder
        ? {
            recorder: input.observabilityRecorder,
            pipelineKey,
            eventType: "MessageParsed",
          }
        : undefined,
    }),
  );
}
