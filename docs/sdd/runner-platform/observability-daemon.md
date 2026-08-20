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

## Конфигурация (ADR-021)

`deployment.manifest.json` → `infra.obs` (см. [ADR-021](../../rfc/adr-021-manifest-env-ssot.md)):

```json
{
  "infra": {
    "obs": {
      "mode": "embedded",
      "readMode": "embedded",
      "serviceUrl": "http://127.0.0.1:3020",
      "dockerize": false,
      "dockerizeAll": false,
      "port": 3020
    }
  }
}
```

Env override:

```bash
DEPLOY__infra__obs__mode=embedded
DEPLOY__infra__obs__readMode=embedded
DEPLOY__infra__obs__serviceUrl=http://127.0.0.1:3020
DEPLOY__infra__obs__dockerize=false
DEPLOY__infra__obs__port=3020
```

> **Удалено:** `RADAR_OBS_MODE`, `DOCKERIZE_OBS`, `DOCKERIZE_ALL` как каналы решения.
