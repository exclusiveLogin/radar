/**
 * ---
 * layer: worker/runtime
 * domain: pipeline/step
 * purpose: Ingress gate — подписка на step.trigger.on[], lane/isolate/stepId фильтры,
 *          debounce через TriggerLayer, wake через onStepTrigger(StepRunContext).
 * ---
 */
import { randomUUID } from "node:crypto";
import type {
  DomainEvent,
  IEventTransport,
  IngestMode,
  PipelineKey,
  PipelineManifest,
  StepDescriptor,
  StepRunContext,
  StepTriggerSource,
  Unsubscribe,
} from "@radar/shared";
import { RADAR_TOPICS } from "@radar/shared";
import { extractWakeIds } from "../workload/pipelineWakeContract.js";
import {
  createTriggerLayer,
  type TriggerContext,
  type TriggerLayer,
} from "../workload/triggerLayer.js";

export type StepTriggerRouterInput = {
  steps: readonly StepDescriptor[];
  transport: IEventTransport;
  onStepTrigger: (ctx: StepRunContext) => void;
  /** RMQ fan-out suffix для trigger-очередей (одна на топик). */
  queueSuffix?: string;
};

export type StepWakePort = {
  wake(pipelineKey: PipelineKey): void;
};

export type StepTriggerMatch = {
  stepId: string;
  pipelineKey: string;
};

const INGEST_MODES = new Set<IngestMode>(["live", "backfill", "manual"]);

function asIngestMode(value: unknown): IngestMode | undefined {
  return typeof value === "string" && INGEST_MODES.has(value as IngestMode)
    ? (value as IngestMode)
    : undefined;
}

function payloadRecord(event: DomainEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

/** Lane: meta → payload.ingestMode → live. */
export function resolveStepLane(event: DomainEvent): IngestMode {
  return (
    asIngestMode(event.meta?.lane) ??
    asIngestMode(payloadRecord(event).ingestMode) ??
    "live"
  );
}

/**
 * Gates перед debounce/wake.
 * @returns false — drop.
 */
export function shouldAcceptStepTrigger(
  step: StepDescriptor,
  event: DomainEvent,
  topic: string,
): boolean {
  const lane = resolveStepLane(event);
  const acceptedLanes = step.trigger.accepts.lane;
  if (acceptedLanes?.length && !acceptedLanes.includes(lane)) return false;

  const payload = payloadRecord(event);
  const payloadStepId =
    typeof payload.stepId === "string" ? payload.stepId : undefined;

  if (event.meta?.isolate === true) {
    if (payloadStepId !== step.id && event.meta.stepId !== step.id) return false;
  }

  if (event.type === "StepRunRequested") {
    if (payloadStepId !== step.id) return false;
  }

  return true;
}

function buildStepRunContext(
  step: StepDescriptor,
  ctx: TriggerContext,
): StepRunContext {
  const event = ctx.event;
  const payload = event ? payloadRecord(event) : {};
  const lane = event ? resolveStepLane(event) : "live";
  const isolate = event?.meta?.isolate === true;
  const correlationId =
    event?.meta?.correlationId ??
    (typeof payload.correlationId === "string" ? payload.correlationId : undefined) ??
    randomUUID();
  const ids =
    ctx.ids ??
    (event
      ? extractWakeIds({ aggregateId: event.aggregateId, payload })
      : undefined);

  return {
    stepId: step.id,
    runId: randomUUID(),
    lane,
    isolate,
    correlationId,
    trigger: {
      topic: ctx.topic ?? "",
      source: (ctx.source ?? "bus") as StepTriggerSource,
      eventId: event?.id,
    },
    ...(ids?.length ? { ids } : {}),
  };
}

/**
 * Подписывается на уникальные trigger.on ключи enabled-шагов.
 * Domain handlers (planning) остаются отдельно — router только будит шаги.
 */
export function wireStepTriggerRouter(input: StepTriggerRouterInput): Unsubscribe {
  const enabled = input.steps.filter((s) => s.enabled);
  const byTopic = new Map<string, StepDescriptor[]>();
  for (const step of enabled) {
    for (const key of step.trigger.on) {
      const list = byTopic.get(key) ?? [];
      list.push(step);
      byTopic.set(key, list);
    }
  }

  const layers = new Map<string, TriggerLayer>();
  for (const step of enabled) {
    layers.set(
      step.id,
      createTriggerLayer({
        debounceMs: step.trigger.debounceMs,
        onRoute: (ctx) => {
          input.onStepTrigger(buildStepRunContext(step, ctx));
        },
      }),
    );
  }

  const unsubs: Unsubscribe[] = [];
  for (const [topic, steps] of byTopic) {
    unsubs.push(
      input.transport.subscribe(
        topic,
        async (event) => {
          for (const step of steps) {
            if (!shouldAcceptStepTrigger(step, event, topic)) continue;
            const ids = extractWakeIds({
              aggregateId: event.aggregateId,
              payload: payloadRecord(event),
            });
            layers.get(step.id)?.fire({
              source: "bus",
              topic,
              event,
              ...(ids.length ? { ids } : {}),
            });
          }
        },
        {
          queueSuffix: input.queueSuffix ?? "step.trigger",
          delivery: "transient",
        },
      ),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
    for (const layer of layers.values()) layer.dispose();
  };
}

/** Удобный вход из composition: манифест → enabled steps. */
export function wireStepTriggerRouterFromManifest(input: {
  manifest: PipelineManifest;
  transport: IEventTransport;
  onStepTrigger: (ctx: StepRunContext) => void;
  queueSuffix?: string;
}): Unsubscribe {
  return wireStepTriggerRouter({
    steps: input.manifest.steps,
    transport: input.transport,
    onStepTrigger: input.onStepTrigger,
    queueSuffix: input.queueSuffix,
  });
}

/**
 * Находит шаги, чей trigger.on содержит topic и (опционально) accepts.lane.
 * Pure helper для admin/manual routing без transport-подписки.
 */
export function matchStepsForTopic(input: {
  manifest: PipelineManifest;
  topic: string;
  lane?: string;
  targetStepId?: string;
}): StepTriggerMatch[] {
  const matches: StepTriggerMatch[] = [];
  for (const step of input.manifest.steps) {
    if (!step.enabled) continue;
    if (input.targetStepId && step.id !== input.targetStepId) continue;
    if (!step.trigger.on.includes(input.topic)) continue;
    const lanes = step.trigger.accepts?.lane;
    if (lanes?.length && input.lane && !lanes.includes(input.lane as IngestMode)) {
      continue;
    }
    matches.push({ stepId: step.id, pipelineKey: step.pipelineKey });
  }
  return matches;
}

/** Будит launcher'ы для matched steps. */
export function routeStepWake(input: {
  matches: StepTriggerMatch[];
  wake: StepWakePort;
  hasWakeable?: (pipelineKey: PipelineKey) => boolean;
}): void {
  for (const match of input.matches) {
    const key = match.pipelineKey as PipelineKey;
    if (input.hasWakeable && !input.hasWakeable(key)) continue;
    input.wake.wake(key);
  }
}

/** Разбор StepRunRequested → match + wake. */
export function routeStepRunRequested(input: {
  manifest: PipelineManifest;
  event: DomainEvent;
  wake: StepWakePort;
  hasWakeable?: (pipelineKey: PipelineKey) => boolean;
}): StepTriggerMatch[] {
  const stepId = String(input.event.payload.stepId ?? input.event.meta?.stepId ?? "");
  if (!stepId) return [];
  const lane = input.event.meta?.lane;
  const matches = matchStepsForTopic({
    manifest: input.manifest,
    topic: RADAR_TOPICS.STEP_RUN_REQUESTED,
    lane,
    targetStepId: stepId,
  });
  if (matches.length === 0) {
    const step = input.manifest.steps.find((s) => s.id === stepId && s.enabled);
    if (step) matches.push({ stepId: step.id, pipelineKey: step.pipelineKey });
  }
  routeStepWake({ matches, wake: input.wake, hasWakeable: input.hasWakeable });
  return matches;
}
