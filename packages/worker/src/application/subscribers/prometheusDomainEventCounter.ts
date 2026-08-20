import { Counter, type Registry } from "prom-client";
import type { DomainEvent, EventHandler } from "@radar/shared";

/**
 * Prometheus-счётчик domain events на in-process bus.
 * Не смешивается с MetricsAggregator (CLI progress).
 */
export class PrometheusDomainEventCounter {
  private readonly counter: Counter<"event_type">;

  constructor(registry: Registry) {
    this.counter = new Counter({
      name: "radar_worker_domain_events_total",
      help: "Domain events, обработанные in-process bus worker",
      labelNames: ["event_type"] as const,
      registers: [registry],
    });
  }

  readonly handler: EventHandler = async (event: DomainEvent) => {
    this.counter.inc({ event_type: event.type });
  };
}
