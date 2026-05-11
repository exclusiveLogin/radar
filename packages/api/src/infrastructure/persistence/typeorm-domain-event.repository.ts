import type { DomainEvent, IDomainEventRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { DomainEventEntity } from "../../events/entities";

export class TypeOrmDomainEventRepository implements IDomainEventRepository {
  constructor(private readonly dataSource: DataSource) {}async append(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    const repo = this.dataSource.getRepository(DomainEventEntity);
    const rows = repo.create(
      events.map((event) => ({
        id: event.id,
        type: event.type,
        version: event.version,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as Record<string, unknown>,
        occurredAt: new Date(event.occurredAt),
        publishedAt: null,
        traceId: event.traceId ?? null,
      })),
    );
    await repo.save(rows, { chunk: 100 });
  }
}
