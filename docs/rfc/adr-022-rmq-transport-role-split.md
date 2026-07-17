# ADR-022: RMQ-only scheduling + parse/geo role split

## Status

Accepted (2026-07-14)

## Context

Планирование pipeline (ingest → parse → geo → tracking) ранее использовало DB-очереди (`queue_parse_coverage`, `job_geo_place_enrich`), outbox relay и in-process bus для cross-process. Это давало dual-path и усложняло split deployment.

## Decision

1. **Единый transport** — `IEventTransport` (`InProcessTransport` | `RmqTransport`). Topic SSOT: `packages/shared/src/transport/topicCatalog.ts`.
2. **RMQ** — единственный канал планирования между процессами. PostgreSQL — persist + config (`phase_definitions`, `phase_runs`).
3. **Role split** — `worker-parse`, `worker-geo` (удалён `worker-phase`). Ollama только на geo.
4. **Phase node** — `triggerMode` + `PhasePolicy.subscribeTopic`; drain/control через signal topics (`RUNNER_DRAIN_*`, `RUNNER_CONTROL`, `GEO_ENRICH_REQUEST`).
5. **OutboxRelay** — не в hot path при `transport.kind=rmq`.
6. **Dedup** — `event.id` LRU + optional `transport_dedup` table.

## Runtime profiles

| Профиль | Worker cascade | API admin |
|---------|----------------|----------|
| `dev --full` | in-process (`role=<ingest|backfill|parse|geo|tracking>`) | RMQ |
| docker dev/prod | RMQ | RMQ |
| host split | RMQ (fail-fast без broker) | RMQ |

## Consequences

- Проще grep-gate: producers только `transport.publish` / `publishSignal`.
- RabbitMQ + Management UI `:15672`, Prometheus `:15692`, Grafana dashboard в compose.
- Legacy `RADAR_WORKER_ROLE=phase` deprecated — используйте `parse` / `geo`.

## RMQ fan-out topology (2026-07-15)

**Проблема as-is:** одна durable-очередь на routing key (`radar_message_parsed`).
Parse / geo / tracking — competing consumers → событие получает только одна роль.

**Решение:**

```
publish → topic exchange (без assert queue на publish)
              ↓ fan-out bind
   {topic_slug}.{parse|geo|tracking|…}
              ↓
   round-robin между репликами одной роли
```

- SSOT имён: `packages/shared/src/transport/rmqQueueName.ts`
- `TransportSubscribeOptions.queueSuffix` — явный override (Wave 6 launchers, phase wake)
- Default suffix: `resolveRmqConsumerSuffix(RADAR_WORKER_ROLE)` / `api`
- Drain/control: подписка только на role-relevant topics (`wireTransportRuntimeSignals`)

См. также [ADR-026](./adr-026-ingest-backfill-role-split.md) (future: ingest vs backfill).
