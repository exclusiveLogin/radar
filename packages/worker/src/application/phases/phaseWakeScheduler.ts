import type {
  IEventTransport,
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  RadarTopicRoutingKey,
} from "@radar/shared";
import {
  drainTopicForPhaseScope,
  RADAR_TOPICS,
  resolveRmqQueueSuffixForPhaseScope,
} from "@radar/shared";
import { wireTransportTrigger } from "../runtime/workload/wireTransportTrigger.js";

export type PhaseWakeSchedulerDeps = {
  transport: IEventTransport;
  phases: IPhaseDefinitionRepository;
  onWake: (phase: PhaseDefinitionRecord) => void;
};

function resolveSubscribeTopic(phase: PhaseDefinitionRecord): RadarTopicRoutingKey {
  return phase.policy.subscribeTopic ?? RADAR_TOPICS.RAW_INGESTED;
}

function wakesOnEvent(phase: PhaseDefinitionRecord): boolean {
  const mode = phase.triggerMode ?? "both";
  return mode === "event" || mode === "both";
}

function wakesOnTimeout(phase: PhaseDefinitionRecord): boolean {
  const mode = phase.triggerMode ?? "both";
  return mode === "timeout" || mode === "both";
}

function resolveIntervalMs(phase: PhaseDefinitionRecord): number {
  return Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
}

/**
 * Event-подписки + timer→RMQ wake(∅) для timeout/both.
 * Локальный drain в обход шины не используется.
 */
export async function wirePhaseWakeScheduler(
  deps: PhaseWakeSchedulerDeps,
): Promise<() => void> {
  const teardown: Array<() => void> = [];
  const enabled = await deps.phases.listAll();

  for (const phase of enabled) {
    if (!phase.enabled) continue;

    if (wakesOnEvent(phase)) {
      const topic = resolveSubscribeTopic(phase);
      teardown.push(
        wireTransportTrigger(deps.transport, topic, {
          debounceMs: Math.max(phase.policy.minIntervalMs, 250),
          onRoute: () => deps.onWake(phase),
          queueSuffix: resolveRmqQueueSuffixForPhaseScope(phase.scope),
        }),
      );
    }

    // timeout/both: периодический RMQ drain-сигнал без ids → shared drain-lane
    if (wakesOnTimeout(phase) && (phase.scope === "ingestParse" || phase.scope === "geoParse")) {
      const intervalMs = resolveIntervalMs(phase);
      const topic = drainTopicForPhaseScope(phase.scope);
      const timer = setInterval(() => {
        void deps.transport.publishSignal(topic, {
          phaseKey: phase.id,
          mode: "full",
        });
      }, intervalMs);
      teardown.push(() => clearInterval(timer));
    }
  }

  return () => teardown.forEach((fn) => fn());
}