# ADR-026: Ingest / Backfill role split (Future)

## Status

Draft (Future) — **не реализуем горизонтальное масштабирование в текущей итерации**

## Context

Сейчас live ingest и backfill истории могут жить в одном worker-процессе (`RADAR_WORKER_ROLE=all` или совмещённый контейнер):

| Поток | Источник | Hot path |
|-------|----------|----------|
| Live | `IngestOrchestrator` + master bindings | realtime MTProto / bot updates |
| Backfill | `BackfillDaemonService` + `job_ingest_backfill` | batch `streamHistory` по cursor |

**Проблемы совмещения:**

1. **Rate limits Telegram** — backfill батчи конкурируют с live за тот же MTProto session slot.
2. **Blast radius** — flood-wait / reconnect на backfill блокирует live канал.
3. **Scaling** — нельзя независимо масштабировать «догон истории» vs «слушать новые».
4. **Ops** — restart backfill-worker не должен ронять live ingest.

Роль `backfill` уже объявлена в `workerRole.ts` (`roleRunsBackfill`), но docker split и изоляция binding-set — **не в scope сейчас**.

## Decision (target)

### Роли ingest plane

```
┌─────────────────┐     ┌──────────────────┐
│ worker-ingest   │     │ worker-backfill  │
│ live bindings   │     │ job_ingest_*     │
│ IngestOrchestr. │     │ BackfillDaemon   │
└────────┬────────┘     └────────┬─────────┘
         │ publish               │ publish
         └───────────┬───────────┘
                     ▼
           radar.raw.ingested (topic exchange)
                     │
         fan-out per role (см. ADR-022)
                     ▼
              parse → geo → tracking
```

1. **`RADAR_WORKER_ROLE=ingest`** — только live: `IngestOrchestrator`, master bindings, **без** `BackfillDaemonService`.
2. **`RADAR_WORKER_ROLE=backfill`** — только batch: poll `job_ingest_backfill`, **без** live orchestrator.
3. **Downstream единый** — оба публикуют `RawMessageIngested` → `radar.raw.ingested`; parse/geo/tracking не различают источник.
4. **RMQ fan-out** — consumer-очереди per role (`radar_raw_ingested.parse`, …), см. ADR-022 § fan-out topology.
5. **DB SSOT** — jobs, cursors, `mat_ingest_raw` без дублирования логики ingest handler.

### Binding policy (future, не сейчас)

- Manifest может разделять `liveBindings` / `backfillBindings` или policy flag на binding.
- Backfill worker берёт только jobs по `binding_id`; live worker — только enabled master bindings.
- **Explicitly out of scope now:** отдельные manifest-секции, sharding jobs между N backfill replicas.

## Invariants

1. Один `IngestRawMessageHandler` / publish contract — live и backfill не форкают write-path.
2. Backfill не обходит transport — всегда `transport.publish`, не direct parse call.
3. Split role = split **Telegram pressure**, не split pipeline semantics.

## Migration path

| Этап | Действие |
|------|----------|
| Now | ADR зафиксирован; monolith/all продолжает работать |
| Next | docker service `worker-backfill` + `worker-ingest`, env `RADAR_WORKER_ROLE` |
| Later | binding sets / job sharding по channel |

## Consequences

- Проще ops: backfill restart изолирован от live.
- Нужен мониторинг двух ingest-ролей (obs host role tag).
- До split — текущий `backfill-v2-pipeline.md` остаётся valid для monolith.

## Related

- [ADR-022](./adr-022-rmq-transport-role-split.md) — RMQ + role split + fan-out
- [ADR-025](./adr-025-unified-pipeline.md) — unified loop downstream
- [backfill-v2-pipeline.md](../backfill-v2-pipeline.md) — runbook
