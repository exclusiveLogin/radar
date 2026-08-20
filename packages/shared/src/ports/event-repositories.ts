/**
 * ---
 * layer: shared/ports
 * bounded-context: transport
 * purpose: Контракт долговременного хранения доменных событий.
 * ---
 */
import type { DomainEvent } from "../schemas/events/domain-event";

export interface IDomainEventRepository {
  append(events: DomainEvent[]): Promise<void>;
}
