import type { DomainEvent } from "@radar/shared";
import { randomUUID } from "node:crypto";

type BuildDomainEventOptions = {
  type: DomainEvent["type"];
  aggregateType: DomainEvent["aggregateType"];
  aggregateId: string;
  payload: DomainEvent["payload"];
};

/** Creates standard versioned domain event envelope with generated id/time. */
export function buildDomainEvent(options: BuildDomainEventOptions): DomainEvent {
  return {
    id: randomUUID(),
    type: options.type,
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: options.aggregateType,
    aggregateId: options.aggregateId,
    payload: options.payload,
  };
}
