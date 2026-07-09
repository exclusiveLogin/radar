# SDD — Observability daemon (push model `obs_*`)

Статус: **Iter 3–6 в коде** · [ADR-017](../../rfc/adr-017-observability-embedded.md) · [observability runbook](../../runbook/observability.md)

---

## Модель

**Push, не pull.** Worker вызывает `IObservabilityRecorder` — не знает про admin UI.

```text
Producer → IObservabilityRecorder
   ├─ embedded → SqlObservabilityRecorder → Postgres obs_*
   └─ service   → HttpObservabilityRecorder → POST /obs/v1/ingest/batch
```

---

## Порт `IObservabilityRecorder`

| Метод | Когда |
|-------|-------|
| `upsertHost` | Старт + heartbeat 10s |
| `upsertExecutor` | Parse worker pool |
| `upsertWorkload` | jobKernel tick |
| `incrementTrigger` | `wireBusTrigger` (Wave 6) |
| `recordMaterialize` | После materialize |

---

## Таблицы `obs_*`

| Таблица | PK | Назначение |
|---------|-----|------------|
| `obs_hosts` | `host_id` | role, ODP badge, heartbeat |
| `obs_executors` | `executor_id` | process/thread |
| `obs_workloads` | `workload_id` | pipeline status, last_tick |
| `obs_trigger_counters` | composite | bus trigger counts |
| `obs_materialize_counters` | `pipeline_key` | materialize counts |

`host_id` SSOT: `worker:{RADAR_WORKER_ROLE}`.

---

## obs-service endpoints

| Endpoint | Метод |
|----------|-------|
| `/health` | GET |
| `/obs/v1/ingest/batch` | POST |
| `/obs/v1/runtime/snapshot` | GET |

```powershell
docker compose --profile obs up -d
curl http://127.0.0.1:3020/health
```

---

## Wiring

| Слой | Файл |
|------|------|
| Factory | `packages/observability/src/recorder/createObservabilityRecorder.ts` |
| Mode resolve | `packages/worker/src/infrastructure/config/obsMode.ts` |
| Composition root | `packages/worker/src/application/createWorkerCompositionRoot.ts` |

---

## Env

```env
RADAR_OBS_MODE=embedded
RADAR_OBS_SERVICE_URL=http://127.0.0.1:3020
RADAR_OBS_READ_MODE=embedded
OBS_PORT=3020
DOCKERIZE_OBS=0
DOCKERIZE_ALL=0
```
