# Runbook: Tracking Pipeline

## Dev-запуск (после pull Round 2)

```powershell
# 1. Postgres
npm run radar -- stack db:up

# 2. Миграция trajectory_* (один раз)
npm run radar -- stack migrate

# 3. Сборка + dev (UI + API + worker с TrackingRebuildDaemon)
npm run radar -- stack dev

# 4. Включить пайплайн
npm run radar -- tracking enable -- --on
# или Admin → /admin → секция «Треки» → ВКЛ

# 5. Первый catch-up (опционально — full rebuild за период)
npm run radar -- tracking rebuild -- --since=2024-01-01T00:00:00Z
# или Admin → Rebuild
```

Карта: панель слоёв → **Треки** / **Flow коридоры**.

Визуальная диагностика live/locus: [tracking-live-locus-debug.md](../features/tracking-live-locus-debug.md).

## Операции

| Действие | CLI | Admin |
|----------|-----|-------|
| Статус | `tracking status` | GET `/admin/tracking/status` |
| ВКЛ/ВЫКЛ | `tracking enable -- --on\|--off` | PATCH `/admin/tracking/enabled` |
| Rebuild | `tracking rebuild -- --since=…` | POST `/admin/tracking/rebuild` |
| Reset | `tracking reset` | POST `/admin/tracking/reset` |
| Pause/Resume | — | POST pause/resume |

## Worker

```powershell
# host dev (--full): worker role=<ingest|backfill|parse|geo|tracking>, tracking daemon внутри
npm run radar -- stack dev

# docker app profile: отдельный контейнер worker-tracking (обязателен для треков!)
# docker compose --profile app up worker-tracking

# только tracking daemon (без ingest/phase)
$env:RADAR_WORKER_ROLE="tracking"
npm run worker:dev
```

## Worker runtime (ADR-021)

`worker.runtime.manifest.json` → `tracking.*` (см. [ADR-021](../rfc/adr-021-manifest-env-ssot.md)):

```json
{ "tracking": { "enabled": true, "intervalMs": 10000 } }
```

| Поле manifest | Default | Смысл |
|---------------|---------|--------|
| `tracking.enabled` | `true` | Глобальный kill-switch |
| `tracking.intervalMs` | `10000` | Тик батча |

Env override: `WORKER__tracking__enabled`, `WORKER__tracking__intervalMs`.

`RADAR_WORKER_ROLE=tracking` — только tracking daemon (host dev).

**Важно:** в `docker-compose.app.yml` ingest/backfill/phase **не** гоняют треки — нужен `worker-tracking` или host `stack dev`.

## Диагностика

- `npm run radar -- tracking status` — JSON watermark + counts
- `npm run radar -- tracking tick` — один тик daemon (ручной прогон)
- `npm run radar -- tracking enable -- --on` — включить пайплайн в БД
- WS `/ws/admin` → `tracking-status`
- Таблицы: `mat_track`, `mat_track_node`, `state_track_pipeline`

## API (read-side)

```http
GET /api/map/tracks?asOf=2024-06-01T12:00:00Z&limit=500
GET /api/map/tracks/flow?minCount=2&limit=200
```
