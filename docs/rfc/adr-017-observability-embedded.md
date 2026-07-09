# ADR-017: Observability embedded (Iter 1)

**Статус:** accepted  
**Дата:** 2026-07-09  
**Связано:** [database-table-naming.md](../database-table-naming.md), миграция `1752900000000-ObsTables`

## Контекст

Runtime-состояние worker (hosts, executors, workloads, triggers) разрознено: HTTP probe, domain SQL, WS pollers. Нет единого write/read контракта для discovery UI.

## Решение (Iter 1)

Bounded context **observability** с push-моделью:

- Порт `IObservabilityRecorder` в `@radar/shared`
- Таблицы `obs_*` в Postgres (embedded write-path)
- Worker создаёт recorder через factory в `packages/api` (`SqlObservabilityRecorder` | `NoopObservabilityRecorder`)
- При старте composition root: `upsertHost` с ODP badge
- Heartbeat host каждые 10s в `runBootstrap`

### Таблицы

| Таблица | PK | Назначение |
|---------|-----|------------|
| `obs_hosts` | `host_id` | role, started_at, last_seen_at, odp_runtime, metrics |
| `obs_executors` | `executor_id` | process/thread, parent_id, status, metrics |
| `obs_workloads` | `workload_id` | pipeline_key, runtime, status, last_tick_at, metrics |
| `obs_trigger_counters` | (pipeline_key, event_type, source) | счётчик триггеров |
| `obs_materialize_counters` | `pipeline_key` | счётчик materialize |

### Env

```bash
RADAR_OBS_MODE=embedded   # default при RADAR_STORAGE_MODE=db
RADAR_OBS_MODE=noop       # отключить запись
```

`host_id` SSOT: `worker:{RADAR_WORKER_ROLE}`.

## Вне scope Iter 1

- `packages/observability` sidecar (Iter 3)
- `HttpObservabilityRecorder` (Iter 3)
- `LegacyWorkloadAdapter`, producers hooks (Iter 2)
- Admin read API / UI (Iter 6)

## Последующие итерации

| Iter | Добавляет |
|------|-----------|
| 2 | Legacy + runner producers, idempotent upserts |
| 3 | obs-service HTTP, `RADAR_OBS_MODE=service` |
| 6 | Nest read + Discovery UI |
