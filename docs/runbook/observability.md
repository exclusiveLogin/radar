# Runbook — Observability (embedded vs service)

База: [ADR-017](../rfc/adr-017-observability-embedded.md) · [ADR-018](../rfc/adr-018-deployment-manifest.md) · SDD: [observability-daemon.md](../sdd/runner-platform/observability-daemon.md)

---

## Зачем

Единый write/read контракт для **Discovery UI**: какие worker-хосты живы, какие workload тикают, сколько bus-триггеров сработало. Producers (worker, jobKernel) **пушат** снимки — UI не лезет в internals раннера.

---

## Два режима write-path

| Режим | `RADAR_OBS_MODE` | Куда пишет worker | Когда |
|-------|------------------|-------------------|-------|
| **embedded** (default в db mode) | `embedded` | Postgres `obs_*` напрямую | Host dev, Docker без sidecar |
| **service** | `service` | HTTP → obs-service → Postgres | Sidecar (`DOCKERIZE_OBS=1`) |
| **выкл** | `noop` | никуда | memory mode, тесты |

> `DOCKERIZE_OBS=1` или `DOCKERIZE_ALL=1` **автоматически** переключают write-path на `service`.

### Read-path (отдельно от write)

| Режим | Env | Откуда читает API |
|-------|-----|-------------------|
| embedded | `RADAR_OBS_READ_MODE=embedded` (default) | SQL `obs_*` |
| service | `RADAR_OBS_READ_MODE=service` | `GET {RADAR_OBS_SERVICE_URL}/obs/v1/runtime/snapshot` |

---

## Быстрая проверка

```powershell
# embedded (host dev)
$env:RADAR_STORAGE_MODE="db"
$env:RADAR_OBS_MODE="embedded"
npm run worker:dev

# service sidecar
$env:DOCKERIZE_OBS="1"
docker compose --profile obs up -d
npm run worker:dev

curl http://127.0.0.1:3020/health
curl http://127.0.0.1:3020/obs/v1/runtime/snapshot
```

В Docker dev overlay URL sidecar: `http://observability:3020`.

---

## Discovery UI

| UI | Где | Что показывает |
|----|-----|----------------|
| **Workbook observability** | Admin → виджет | Registry, active workloads, run history |
| **Worker runners** | Admin → «Раннеры worker» | Probe ingest/backfill |
| **ODP badge** | Лог worker | `[odp] tracking → legacy (…)` |
| **obs_hosts** | SQL / snapshot API | `host_id`, `odp_runtime[]`, heartbeat |

### SQL-диагностика

```sql
SELECT host_id, role, last_seen_at, odp_runtime FROM obs_hosts ORDER BY last_seen_at DESC;
SELECT workload_id, pipeline_key, status, last_tick_at FROM obs_workloads ORDER BY last_tick_at DESC NULLS LAST;
SELECT pipeline_key, event_type, source, count FROM obs_trigger_counters ORDER BY count DESC;
```

---

## Troubleshooting

| Симптом | Решение |
|---------|---------|
| `obs_hosts` пусто | `RADAR_STORAGE_MODE=db`, mode ≠ noop |
| Snapshot 404 | `docker compose --profile obs up -d` |
| ECONNREFUSED на ingest | URL: `observability:3020` в Docker, `127.0.0.1` на хосте |

---

## См. также

- [docker-dev-stack.md](../docker-dev-stack.md)
- [sdd/runner-platform/runbook.md](../sdd/runner-platform/runbook.md)
- [prod-cutover.md](./prod-cutover.md)
