# Runbook — E2E bus chaining (raw → parse → tracking → geo)

База: [ADR-016](../adr-016-runner-platform.md) Wave 6 · [how-it-works.md](../domain/how-it-works.md)

---

## Предусловия

```powershell
$env:PARSE_RUNNER_PLATFORM_ENABLED="true"
$env:GEO_ENRICH_RUNNER_PLATFORM_ENABLED="true"
$env:TRACKING_RUNNER_PLATFORM_ENABLED="true"
$env:TRACKING_DAEMON_ENABLED="true"
npm run radar -- stack dev --full
```

---

## Цепочка

| Переход | Событие | Debounce |
|---------|---------|----------|
| raw → parse | `RawMessageIngested` | 250ms |
| parse → tracking | `MessageParsed` | 250ms |
| parse → geo | `MessageParsed` | 250ms |

Polling (`hybrid schedule`) — резерв если событие потеряно.

---

## E2E шаги

1. Inject: `POST /api/admin/ingest/messages` или live Telegram
2. SQL parse: `mat_parse_event`, `mat_parse_location`
3. Obs triggers: `SELECT * FROM obs_trigger_counters`
4. Tracking: `mat_track`, `GET /api/map/tracks`
5. Geo: `job_geo_place_enrich`

---

## Диагностика

| Симптом | Fix |
|---------|-----|
| Parse не будится | `PARSE_RUNNER_PLATFORM_ENABLED=true` |
| Tracking молчит | `TRACKING_RUNNER_PLATFORM_ENABLED` + daemon enabled |
| Trigger count = 0 | `RADAR_OBS_MODE` ≠ noop |
| Duplicate parse | Legacy + runner-platform одновременно — запрещено |

---

## CLI smoke

```powershell
npm run radar -- ingest backfill -- --all-bindings --batch-size=10
npm run radar -- parse run
npm run radar -- pipeline status
```

Acceptance: trigger counters > 0, workloads drain, нет duplicate parse.
