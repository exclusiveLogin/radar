# Tracking Round 2 — Incremental Admin

## Scope

- DB: `mat_track`, `mat_track_node`, `job_track_rebuild`, `state_track_pipeline`
- Worker: `TrackingRebuildDaemon` — watermark + batch UPSERT (500–2000 точек)
- Admin API: `/admin/tracking/*` — status, runs, config, enabled, rebuild/reset/pause/resume/cancel
- WS: канал `tracking-status` (poll 3s)
- Web: admin-секция «Треки», `trackStoreEffects` → `/map/tracks`

## Watermark

```typescript
{ lastOccurredAt: ISO, lastEventLocationId: uuid }
```

Хранится в `state_track_pipeline.watermark`; копия в `job_track_rebuild.checkpoint`.

## Пайплайн батча

1. load open tracks (`status=active`)
2. load candidates after watermark + overlap `ε_temporal`
3. per-profile ST-DBSCAN → Kalman → UPSERT
4. advance watermark

## Env (worker.runtime.manifest)

| Поле / override | Default |
|-----------------|--------|
| `tracking.intervalMs` / `WORKER__tracking__intervalMs` | 10000 |
| `tracking.enabled` / `WORKER__tracking__enabled` | true |
| `TRACKING_BATCH_SIZE` (pipeline config в БД) | 1000 |
| `RADAR_WORKER_ROLE` | `all` или `tracking` |

## Admin UI

- **PipelineWidget** — ВКЛ/ВЫКЛ, %, Rebuild/Reset/Pause/Resume
- **ScannersWidget** — ST-DBSCAN / Kalman stats
- **KinematicsSettings** — overrides `PROFILE_KINEMATICS`
- **RunHistory** — таблица runs

См. также: [runbook/tracking-pipeline.md](../../runbook/tracking-pipeline.md)
