# Phase-pipeline v2 — статус внедрения

Сверка с планом «Унифицированный Phase-pipeline». Дата актуализации: 2026-06.

## Сделано

| Область | Статус |
|---------|--------|
| Схемы `trigger`, `policy`, `phase_coverage`, `phase_runs` | ✅ |
| Миграция `1748500000000-PhasePipelineV2` | ✅ |
| `PhaseRunner`, `CoverageEnqueuer`, `PhaseDaemon` | ✅ |
| Ingest SSOT `phaseIngestFlow` | ✅ |
| Reparse = invalidate + ingest-поток | ✅ |
| Порядок фаз (`order`) в `claimBatch` | ✅ |
| Admin `/api/admin/phases/*`, `PhasesWidget` | ✅ |
| CLI `worker:phase:run`, `phase:manifest:import` | ✅ |
| Манифест `phase.manifest.default.json` | ✅ |
| Доки: phase-pipeline, phases-admin, ADR v2, cheatsheet | ✅ |
| Пустой тик: честный `pendingRemaining` | ✅ |

## Частично / backlog

| Пункт | Статус |
|-------|--------|
| WS `phase-progress` | ❌ polling REST |
| `policy.concurrency` параллельные run | ❌ один batch на фазу |
| `POST /replay` + `runEagerNow` в API | ⚠️ invalidate+catchUp; eager только через worker/reparse |
| JobDaemon / job_* tables | ✅ удалены (`DropJobScheduler1748600000000`) |
| Rate-limit / debounce `minIntervalMs` в daemon | ⚠️ interval per phase, debounce упрощён |

## Не в scope v1

- `parse:snap` / `parse:report` — вне pipeline (лаборатория).
- Селекторы `head/tail` в манифесте — только manual scope.

## Проверка «всё работает»

1. `npm run migration:run`
2. `npm run phase:manifest:import`
3. `npm run build` (shared, api, worker, web)
4. `npm run worker:dev` + ingest сообщения
5. Админка → виджет фаз → coverage `catalog` done, `llm` pending→done при enabled
6. `npm run worker:reparse:raw` — карта сбрасывается, catalog eager на всех raw
