# Runbook — Observability (embedded vs service)

База: [ADR-017](../rfc/adr-017-observability-embedded.md) · [ADR-018](../rfc/adr-018-deployment-manifest.md) · [ADR-021](../rfc/adr-021-manifest-env-ssot.md) · SDD: [observability-daemon.md](../sdd/runner-platform/observability-daemon.md)

---

## Зачем

Единый write/read контракт для **Discovery UI**: какие worker-хосты живы, какие workload тикают, сколько bus-триггеров сработало. Producers (worker, jobKernel) **пушат** снимки — UI не лезет в internals раннера.

---

## Два режима write-path

Конфиг: `deployment.manifest.json` → `infra.obs` (overlay: `DEPLOY__infra__obs__*`).
Резолв: `resolveObsConfig(manifest.infra.obs, storageMode)`.

| Режим | `infra.obs.mode` | Куда пишет worker | Когда |
|-------|------------------|-------------------|-------|
| **embedded** (default в db mode) | `embedded` | Postgres `obs_*` напрямую | Host dev, Docker без sidecar |
| **service** | `service` | HTTP → obs-service → Postgres | Sidecar (`infra.obs.dockerize=true`) |
| **выкл** | `noop` | никуда | memory mode, тесты |

> `infra.obs.dockerize=true` или `infra.obs.dockerizeAll=true` **автоматически** переключают write-path на `service`.

### Read-path (отдельно от write)

| Режим | Manifest | Откуда читает API |
|-------|----------|-------------------|
| embedded | `infra.obs.readMode=embedded` (default) | SQL `obs_*` |
| service | `infra.obs.readMode=service` | `GET {infra.obs.serviceUrl}/obs/v1/runtime/snapshot` |

---

## Быстрая проверка

```powershell
# embedded (host dev)
$env:RADAR_STORAGE_MODE="db"
# default: deployment.manifest.json infra.obs.mode=embedded
npm run worker:dev

# service sidecar (manifest overlay)
$env:DEPLOY__infra__obs__dockerize="true"
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
| `obs_hosts` пусто | `RADAR_STORAGE_MODE=db`, `infra.obs.mode` ≠ noop |
| Snapshot 404 | `docker compose --profile obs up -d` |
| ECONNREFUSED на ingest | URL: `observability:3020` в Docker, `127.0.0.1` на хосте |

---

## См. также

- [docker-dev-stack.md](../docker-dev-stack.md)
- [sdd/runner-platform/runbook.md](../sdd/runner-platform/runbook.md)
- [prod-cutover.md](./prod-cutover.md)
