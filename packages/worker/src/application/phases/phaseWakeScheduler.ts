import type {
  IEventTransport,
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  RadarTopicRoutingKey,
} from "@radar/shared";
import { RADAR_TOPICS, resolveRmqQueueSuffixForPhaseScope } from "@radar/shared";
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

/**
 * Подписка transport по triggerMode + subscribeTopic из phase_definitions.
 */
export async function wirePhaseWakeScheduler(
  deps: PhaseWakeSchedulerDeps,
): Promise<() => void> {
  const teardown: Array<() => void> = [];
  const enabled = await deps.phases.listAll();

  for (const phase of enabled) {
    if (!phase.enabled || !wakesOnEvent(phase)) continue;
    const topic = resolveSubscribeTopic(phase);
    teardown.push(
      wireTransportTrigger(deps.transport, topic, {
        debounceMs: Math.max(phase.policy.minIntervalMs, 250),
        onRoute: () => deps.onWake(phase),
        queueSuffix: resolveRmqQueueSuffixForPhaseScope(phase.scope),
      }),
    );
  }

  return () => teardown.forEach((fn) => fn());
}
