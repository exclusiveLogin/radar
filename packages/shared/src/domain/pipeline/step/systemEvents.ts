/**
 * ---
 * layer: shared/domain
 * purpose: Фабрики системных DomainEvent для step lifecycle и admin-интервенций.
 * ---
 */
import { randomUUID } from "node:crypto";
import type { DomainEvent, DomainEventMeta } from "../../../schemas/events/domain-event.js";
import type { IngestMode } from "../../../schemas/ingest/ingest-domain.js";

function baseEvent(
  type: DomainEvent["type"],
  payload: Record<string, unknown>,
  meta?: DomainEventMeta,
  aggregateId: string | null = null,
): DomainEvent {
  return {
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "step",
    aggregateId,
    payload,
    ...(meta ? { meta } : {}),
  };
}

export function createStepRunRequestedEvent(input: {
  stepId: string;
  lane?: IngestMode;
  isolate?: boolean;
  ids?: string[];
  correlationId?: string;
}): DomainEvent {
  return baseEvent(
    "StepRunRequested",
    {
      stepId: input.stepId,
      ...(input.ids ? { ids: input.ids } : {}),
    },
    {
      stepId: input.stepId,
      lane: input.lane ?? "manual",
      isolate: input.isolate ?? false,
      correlationId: input.correlationId ?? randomUUID(),
    },
    input.stepId,
  );
}

export function createStepResetRequestedEvent(input: {
  stepId: string;
  cascade?: boolean;
  dryRun?: boolean;
  correlationId?: string;
}): DomainEvent {
  return baseEvent(
    "StepResetRequested",
    {
      stepId: input.stepId,
      cascade: input.cascade ?? true,
      dryRun: input.dryRun ?? false,
    },
    {
      stepId: input.stepId,
      lane: "manual",
      correlationId: input.correlationId ?? randomUUID(),
    },
    input.stepId,
  );
}

export function createStepStartedEvent(input: {
  stepId: string;
  runId: string;
  meta?: DomainEventMeta;
}): DomainEvent {
  return baseEvent(
    "StepStarted",
    { stepId: input.stepId, runId: input.runId },
    { ...input.meta, stepId: input.stepId, runId: input.runId },
    input.stepId,
  );
}

export function createStepDrainedEvent(input: {
  stepId: string;
  runId: string;
  meta?: DomainEventMeta;
  stats?: Record<string, unknown>;
}): DomainEvent {
  return baseEvent(
    "StepDrained",
    { stepId: input.stepId, runId: input.runId, ...(input.stats ?? {}) },
    { ...input.meta, stepId: input.stepId, runId: input.runId },
    input.stepId,
  );
}

export function createStepFailedEvent(input: {
  stepId: string;
  runId: string;
  reason: string;
  meta?: DomainEventMeta;
}): DomainEvent {
  return baseEvent(
    "StepFailed",
    { stepId: input.stepId, runId: input.runId, reason: input.reason },
    { ...input.meta, stepId: input.stepId, runId: input.runId },
    input.stepId,
  );
}

export function createSystemInitEvent(): DomainEvent {
  return {
    id: randomUUID(),
    type: "SystemInit",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "system",
    aggregateId: null,
    payload: {},
  };
}

export function createSystemDrainEvent(input?: { reason?: string }): DomainEvent {
  return {
    id: randomUUID(),
    type: "SystemDrain",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "system",
    aggregateId: null,
    payload: { reason: input?.reason ?? "shutdown" },
  };
}
