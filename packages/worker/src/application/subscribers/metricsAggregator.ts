import type { DomainEvent, EventHandler } from "@radar/shared";

export class MetricsAggregator {
  private readonly counters = new Map<string, number>();

  readonly handler: EventHandler = async (event: DomainEvent) => {
    const current = this.counters.get(event.type) ?? 0;
    this.counters.set(event.type, current + 1);
  };

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }
}
