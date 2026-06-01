# Admin API: Phases

Префикс: `/api/admin/phases`. Swagger: `/api/docs` → `admin-phases`.

## Фазы

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/` | Список `phase_definitions` |
| PATCH | `/{id}` | `{ enabled?, policy?, enrichers? }` — при `enabled=true` catch-up |

## Runs и прогресс

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/runs/overview` | `runningCount`, `byPhase[].coverage` — **главный KPI бэклога** |
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

Виджет **phases** в OSINT-админке: список фаз, coverage, Run, последние runs, Cancel.

Polling ~10s (WS `phase-progress` — backlog).

