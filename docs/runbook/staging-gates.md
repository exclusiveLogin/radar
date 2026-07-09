# Runbook — Staging Gates A–D

База: [release-checklist.md](../sdd/runner-platform/release-checklist.md) · [ADR-016](../adr-016-runner-platform.md)

Чеклист для **staging** перед prod cutover runner platform.

---

## Подготовка

```powershell
$env:RADAR_STORAGE_MODE="db"
$env:TRACKING_RUNNER_PLATFORM_ENABLED="false"
$env:PARSE_RUNNER_PLATFORM_ENABLED="false"
$env:GEO_ENRICH_RUNNER_PLATFORM_ENABLED="false"
npm run radar -- stack dev --full
npm run radar -- pipeline status
```

Зафиксировать baseline: counts `mat_parse_event`, `mat_track`, скрин Workbook observability.

---

## Gate A — Correctness

| # | Шаг | Pass |
|---|-----|------|
| A1 | Включить флаг одного домена, restart worker | `[odp] → runner-platform` в логе |
| A2 | Replay/live ≥1ч | — |
| A3 | Counts mat_parse_event ±delta ожидаемый | SQL |
| A4 | Golden fixtures / unit tests | CI green |
| A5 | `parse run --limit=50` | Без failed spike |

---

## Gate B — Consistency

| # | Проверка | Pass |
|---|----------|------|
| B1 | Workbook observability ↔ SQL cursors | Совпадает |
| B2 | `obs_workloads` status | running/paused, не stale |
| B3 | `npm run radar -- dev ws-smoke` | OK |
| B4 | `GET /api/map/snapshot` | Fold ok |

---

## Gate C — Operability

| # | Операция | API/CLI |
|---|----------|---------|
| C1 | Pause | `POST /admin/tracking/pause` |
| C2 | Resume | `POST /admin/tracking/resume` |
| C3 | Reset | `tracking reset` |
| C4 | Restart worker | Cursor из БД, без duplicate |
| C5 | Rebuild | `tracking rebuild --since=…` |

---

## Gate D — Rollback

| # | Шаг | Pass |
|---|-----|------|
| D1 | Флаг=false, restart | `[odp] → legacy` |
| D2 | Cursor тот же | SQL watermark |
| D3 | Нет параллельного tick | Один раннер |

Порядок доменов: **parse → geo-enrich → tracking**.

После sign-off → [prod-cutover.md](./prod-cutover.md).
