/**
 * Poll event_outbox → InProcessEventBus. Атомарный claim в транзакции (FOR UPDATE SKIP LOCKED).
 * @see ../../../../../docs/domain/domain-events-and-outbox.md
 */
import type { DomainEvent, IEventPublisher } from "@radar/shared";
import type { DataSource, EntityManager } from "typeorm";

/** Строка claim из event_outbox (FOR UPDATE SKIP LOCKED). */
type DomainEventRow = {
  id: string;
  type: string;
  version: number;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
  trace_id: string | null;
};

const CLAIM_UNPUBLISHED_SQL = `
  SELECT id, type, version, aggregate_type, aggregate_id, payload, occurred_at, trace_id
  FROM event_outbox
  WHERE published_at IS NULL
  ORDER BY occurred_at ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED
`;

/** TypeORM setLock(…, ["skip_locked"]) — это FOR UPDATE OF, не SKIP LOCKED; только raw SQL. */
async function claimUnpublishedEvents(manager: EntityManager): Promise<DomainEventRow[]> {
  return manager.query<DomainEventRow[]>(CLAIM_UNPUBLISHED_SQL);
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

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
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.dataSource.transaction(async (manager) => {
        const rows = await claimUnpublishedEvents(manager);

        if (rows.length === 0) return;

        const events: DomainEvent[] = rows.map((row) => ({
          id: row.id,
          type: row.type as DomainEvent["type"],
          version: row.version,
          occurredAt: row.occurred_at.toISOString(),
          aggregateType: row.aggregate_type as DomainEvent["aggregateType"],
          aggregateId: row.aggregate_id,
          payload: row.payload as Record<string, unknown>,
          traceId: row.trace_id ?? undefined,
        }));

        await this.bus.publish(events);

        const now = new Date();
        await manager.query(
          `UPDATE event_outbox SET published_at = $1 WHERE id = ANY($2::uuid[])`,
          [now, rows.map((row) => row.id)],
        );
      });
    } finally {
      this.ticking = false;
    }
  }
}
