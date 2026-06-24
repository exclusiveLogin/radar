# Admin API: Phases

Префикс: `/api/admin/phases`. Swagger: `/api/docs` → `admin-phases`.

## Фазы

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/` | Список `phase_definitions` |
| PATCH | `/{id}` | `{ enabled?, policy?, enrichers? }` — при `enabled=true`: ingest → `phase_coverage` catch-up; geo → `place_enrichment_jobs` catch-up |

## Runs и прогресс

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/runs/overview` | `ingest.byPhase[].coverage` + `geo.byPhase[].jobs` (раздельно) |
| GET | `/runs?phaseId&status&limit` | История `phase_runs` |
| GET | `/runs/{id}` | Карточка + `logTail` |
| POST | `/{id}/run` | Manual: enqueue scope → `phase_run` pending (исполнение — worker/CLI) |
| POST | `/runs/{id}/cancel` | `control=cancel` |
| POST | `/runs/{id}/pause` | `control=pause` |
| POST | `/runs/{id}/resume` | resume paused |
| DELETE | `/runs/{id}` | Force stop + reset `processing` coverage |

## Replay / invalidation

```http
POST /api/admin/phases/replay
Content-Type: application/json

{
  "phaseIds": ["catalog", "llm"],
  "invalidateCoverage": true,
  "resetMapState": false,
  "runEagerNow": true
}
```

| Поле | Поведение |
|------|-----------|
| `invalidateCoverage` | `done/failed/processing` → `pending` + catch-up |
| `resetMapState` | ⚠️ в API пока не вызывает worker reset — для полного сброса карты используйте `npm run worker:reparse:raw` |
| `runEagerNow` | ⚠️ в API не запускает worker — после replay нужен `worker:dev` или `worker:reparse:raw` |

## Web UI

| Виджет | Секция `/admin` | Описание |
|--------|-----------------|----------|
| **Сводка системы** | Система | `GET /api/admin/stats/overview` — ingest/parse KPI + `phaseEnrichment[]` |
| **Parse-engine** | Обогащение | Ingest / Geo: тогглы, Run, очереди, runs, stop-all |

Realtime: WS **`phases-update`** (~3s, push от API) — `overview` + `runs`.  
Backlog: отдельный канал `phase-progress` (гранулярный прогресс batch).

