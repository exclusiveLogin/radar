import type { IEventPublisher } from "@radar/shared";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import { DomainEventEntity } from "../../events/entities";

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly bus: IEventPublisher,
    private readonly pollMs = 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    const repo = this.dataSource.getRepository(DomainEventEntity);
    const rows = await repo.find({
      where: { publishedAt: IsNull() },
      order: { occurredAt: "ASC" },
      take: 100,
    });
    if (rows.length === 0) return;
    await this.bus.publish(
      rows.map((row) => ({
        id: row.id,
        type: row.type as never,
        version: row.version,
        occurredAt: row.occurredAt.toISOString(),
        aggregateType: row.aggregateType as never,
        aggregateId: row.aggregateId,
        payload: row.payload,
        traceId: row.traceId ?? undefined,
      })),
    );
    const now = new Date();
    for (const row of rows) {
      row.publishedAt = now;
    }
    await repo.save(rows);
  }
}
