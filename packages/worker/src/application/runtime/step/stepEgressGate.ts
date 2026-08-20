/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Gate исходящих emits: whitelist + isolate → suppress; lifecycle keys bypass isolate.
 * ---
 */
import { randomUUID } from "node:crypto";
import type {
  DomainEvent,
  DomainEventMeta,
  IEventTransport,
  PipelineManifest,
  StepDescriptor,
  StepEmit,
  StepRunContext,
} from "@radar/shared";
import { downstreamStepIds, RADAR_TOPICS, createStepStartedEvent, createStepDrainedEvent, createStepFailedEvent } from "@radar/shared";

const LIFECYCLE_KEYS = new Set<string>([
  RADAR_TOPICS.STEP_STARTED,
  RADAR_TOPICS.STEP_DRAINED,
  RADAR_TOPICS.STEP_FAILED,
]);

export type StepEgressDecision = {
  emit: boolean;
  reason?: "isolate" | "not-in-emits";
};

export type SuppressedEmit = {
  key: string;
  downstreamStepIds: string[];
};

export type PublishStepEmitsResult = {
  published: string[];
  suppressed: SuppressedEmit[];
};

/**
 * Незадекларированный key (кроме lifecycle) — ошибка конфигурации.
 * isolate подавляет domain emits; lifecycle проходит с meta.isolate.
 */
export function evaluateStepEgress(input: {
  manifest: PipelineManifest;
  stepId: string;
  key: string;
  meta?: DomainEventMeta;
}): StepEgressDecision {
  if (LIFECYCLE_KEYS.has(input.key)) {
    return { emit: true };
  }
  const step = input.manifest.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw new Error(`evaluateStepEgress: unknown step "${input.stepId}"`);
  }
  if (!step.emits.includes(input.key)) {
    throw new Error(
      `emit key "${input.key}" is not in step "${input.stepId}" emits whitelist`,
    );
  }
  if (input.meta?.isolate) return { emit: false, reason: "isolate" };
  return { emit: true };
}

export function filterStepEmits(input: {
  manifest: PipelineManifest;
  stepId: string;
  emits: StepEmit[];
  meta?: DomainEventMeta;
}): { allowed: StepEmit[]; suppressed: SuppressedEmit[] } {
  const suppressed: SuppressedEmit[] = [];
  const allowed: StepEmit[] = [];
  const downstream = downstreamStepIds(input.manifest, input.stepId);
  for (const emit of input.emits) {
    const decision = evaluateStepEgress({
      manifest: input.manifest,
      stepId: input.stepId,
      key: emit.key,
      meta: input.meta,
    });
    if (decision.emit) allowed.push(emit);
    else suppressed.push({ key: emit.key, downstreamStepIds: downstream });
  }
  return { allowed, suppressed };
}

export function shouldPublishStepEvent(input: {
  manifest: PipelineManifest;
  stepId: string;
  routingKey: string;
  event: DomainEvent;
}): boolean {
  return evaluateStepEgress({
    manifest: input.manifest,
    stepId: input.stepId,
    key: input.routingKey,
    meta: input.event.meta,
  }).emit;
}

function stampEvent(emit: StepEmit, ctx: StepRunContext): DomainEvent {
  return {
    id: randomUUID(),
    type: "MetricSampleEmitted",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "step",
    aggregateId: emit.aggregateId ?? ctx.stepId,
    payload: emit.payload,
    meta: {
      stepId: ctx.stepId,
      runId: ctx.runId,
      lane: ctx.lane,
      isolate: ctx.isolate,
      correlationId: ctx.correlationId,
    },
  };
}

/** Публикует emits через transport с whitelist/isolate. */
export async function publishStepEmits(input: {
  step: StepDescriptor;
  ctx: StepRunContext;
  emits: StepEmit[];
  transport: IEventTransport;
  manifest: PipelineManifest;
}): Promise<PublishStepEmitsResult> {
  const published: string[] = [];
  const suppressed: SuppressedEmit[] = [];
  const downstream = downstreamStepIds(input.manifest, input.step.id);
  const meta: DomainEventMeta = {
    stepId: input.ctx.stepId,
    runId: input.ctx.runId,
    lane: input.ctx.lane,
    isolate: input.ctx.isolate,
    correlationId: input.ctx.correlationId,
  };

  for (const emit of input.emits) {
    const decision = evaluateStepEgress({
      manifest: input.manifest,
      stepId: input.step.id,
      key: emit.key,
      meta,
    });
    if (!decision.emit) {
      suppressed.push({ key: emit.key, downstreamStepIds: downstream });
      continue;
    }
    const event = stampEvent(emit, input.ctx);
    await input.transport.publish(emit.key, [event]);
    published.push(emit.key);
  }

  return { published, suppressed };
}

export type StepEgressResult = PublishStepEmitsResult;

async function publishLifecycle(
  transport: IEventTransport,
  topic: string,
  event: DomainEvent,
): Promise<void> {
  await transport.publish(topic, [event]);
}

export async function publishStepStarted(
  transport: IEventTransport,
  ctx: StepRunContext,
): Promise<void> {
  await publishLifecycle(
    transport,
    RADAR_TOPICS.STEP_STARTED,
    createStepStartedEvent({
      stepId: ctx.stepId,
      runId: ctx.runId,
      meta: {
        stepId: ctx.stepId,
        runId: ctx.runId,
        lane: ctx.lane,
        isolate: ctx.isolate,
        correlationId: ctx.correlationId,
      },
    }),
  );
}

export async function publishStepDrained(
  transport: IEventTransport,
  ctx: StepRunContext,
  stats?: Record<string, unknown>,
  suppressed?: SuppressedEmit[],
): Promise<void> {
  await publishLifecycle(
    transport,
    RADAR_TOPICS.STEP_DRAINED,
    createStepDrainedEvent({
      stepId: ctx.stepId,
      runId: ctx.runId,
      meta: {
        stepId: ctx.stepId,
        runId: ctx.runId,
        lane: ctx.lane,
        isolate: ctx.isolate,
        correlationId: ctx.correlationId,
      },
      stats: { ...stats, suppressed: suppressed?.length ?? 0 },
    }),
  );
}

export async function publishStepFailed(
  transport: IEventTransport,
  ctx: StepRunContext,
  reason: string,
): Promise<void> {
  await publishLifecycle(
    transport,
    RADAR_TOPICS.STEP_FAILED,
    createStepFailedEvent({
      stepId: ctx.stepId,
      runId: ctx.runId,
      reason,
      meta: {
        stepId: ctx.stepId,
        runId: ctx.runId,
        lane: ctx.lane,
        isolate: ctx.isolate,
        correlationId: ctx.correlationId,
      },
    }),
  );
}
