/**
 * ---
 * layer: shared/domain
 * purpose: Конструкторы DomainEvent для cascade-триггеров между pipeline.
 * ---
 */
import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../schemas/events/domain-event.js";

/** Parse/geo дренированы → downstream wake (tracking). */
export function createPipelineStabilizedEvent(input: {
  pipelineKey: string;
  phaseKey?: string;
}): DomainEvent {
  return {
    id: randomUUID(),
    type: "PipelineStabilized",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "system",
    aggregateId: input.pipelineKey,
    payload: {
      pipelineKey: input.pipelineKey,
      ...(input.phaseKey ? { phaseKey: input.phaseKey } : {}),
    },
  };
}

/** Backfill канала исчерпан → parse forward / tracking. */
export function createChannelBackfillCompletedEvent(input: {
  channelId: string;
  channelKey: string;
  providerKey: string;
  jobId: string;
}): DomainEvent {
  return {
    id: randomUUID(),
    type: "ChannelBackfillCompleted",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "channel",
    aggregateId: input.channelId,
    payload: {
      channelId: input.channelId,
      channelKey: input.channelKey,
      providerKey: input.providerKey,
      jobId: input.jobId,
    },
  };
}
