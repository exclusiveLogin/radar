# Runbook — Prod cutover (runner platform + observability)

База: [staging-gates.md](./staging-gates.md) · [release-checklist.md](../sdd/runner-platform/release-checklist.md) · [observability.md](./observability.md)

Go-live чеклист после прохождения Gate A–D на staging.

---

## Env / manifest (prod)

```env
# deployment.manifest.json — SSOT; env overlay через DEPLOY__*:
DEPLOY__infra__obs__dockerize=true
DEPLOY__infra__obs__mode=service
DEPLOY__infra__obs__readMode=service
DEPLOY__infra__obs__serviceUrl=http://observability:3020
DEPLOY__runners__pipelines__parse__schedulingImpl=runner-platform
DEPLOY__runners__pipelines__geo-enrich__schedulingImpl=runner-platform
DEPLOY__runners__pipelines__tracking__schedulingImpl=runner-platform

# worker.runtime.manifest.json:
WORKER__tracking__enabled=true
```

SSOT топологии: `deployment.manifest.json` + [ADR-018](../rfc/adr-018-deployment-manifest.md) + [ADR-021](../rfc/adr-021-manifest-env-ssot.md).

---

## Порядок cutover

1. **Obs sidecar** — поднять и проверить health до переключения раннеров
2. **parse** — флаг on, мониторинг 24–48ч
3. **geo-enrich** — после стабильного parse
4. **tracking** — последним (самый чувствительный)

На каждый шаг: Gate D rollback plan готов (флаг off + restart).

---

## Discovery monitoring (prod)

### При старте worker

```text
[odp] parse → runner-platform (ingestParse scheduled phases …)
[odp] geo-enrich → runner-platform (…)
[odp] tracking → runner-platform (…)
```

### Health checks

```powershell
# Sidecar
curl http://observability:3020/health

# Runtime snapshot
curl http://observability:3020/obs/v1/runtime/snapshot

# API probe
curl http://api:3000/api/ready
curl http://api:3000/api/worker/status
```

### SQL алерты (ручные / cron)

```sql
-- Stale host (> 3 min без heartbeat)
SELECT host_id, last_seen_at FROM obs_hosts
WHERE last_seen_at < now() - interval '3 minutes';

-- Workload stuck in running без tick
SELECT * FROM obs_workloads
WHERE status = 'running' AND last_tick_at < now() - interval '10 minutes';

-- Trigger drought (нет bus activity)
SELECT sum(count) FROM obs_trigger_counters;
```

### Admin UI

| Виджет | Что мониторить |
|--------|----------------|
| Workbook observability | activeWorkloads stuck paused/running |
| Worker runners | probe unreachable |
| Map / WS | snapshot lag |

---

## Rollback (prod)

```powershell
# 1. Вернуть schedulingImpl: legacy для проблемного домена
$env:DEPLOY__runners__pipelines__parse__schedulingImpl="legacy"

# 2. Restart worker role
# docker compose restart worker-phase

# 3. Проверить legacy подхватил cursor
# SQL watermark / coverage

# 4. obs_hosts обновится на следующем heartbeat
```

Не удалять legacy-код до Wave 7 — см. [wave7-legacy-removal.md](./wave7-legacy-removal.md).

---

## Sign-off

- [ ] Staging Gate A–D pass для домена
- [ ] Obs sidecar healthy ≥24h
- [ ] Rollback проверен на staging (Gate D)
- [ ] On-call знает SQL + Admin UI checks
- [ ] 48h мониторинг после cutover без инцидентов
