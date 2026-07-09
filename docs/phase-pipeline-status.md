# Phase-pipeline v2 (PE 2.0) — статус внедрения

Сверка с планом «Унифицированный Phase-pipeline». Актуализация: **2026-06-23**.

## Сделано

| Область | Статус |
|---------|--------|
| Схемы `trigger`, `policy`, `queue_parse_coverage`, `log_parse_phase_run` | ✅ |
| Миграция `1748500000000-PhasePipelineV2` | ✅ |
| `PhaseRunner`, `CoverageEnqueuer`, `IngestParseDaemon` | ✅ |
| Ingest SSOT `phaseIngestFlow` | ✅ |
| Reparse = invalidate + ingest-поток | ✅ |
| Порядок фаз (`order`) в `claimBatch` | ✅ |
| Admin REST `/api/admin/phases/*` | ✅ |
| CLI `worker:phase:run`, `phase:manifest:import` | ✅ |
| Манифест `phase.manifest.default.json` | ✅ |
| Доки: phase-pipeline, phases-admin, ADR v2, cheatsheet | ✅ |
| Пустой тик: честный `pendingRemaining` | ✅ |
| JobDaemon / `job_*` tables | ✅ удалены (`DropJobScheduler1748600000000`) |

### Админка (PE 2.0 UI) — **готово**

| Компонент | Где | Что даёт |
|-----------|-----|----------|
| **Сводка системы** | `MessagesStatsWidget` (секция «Система») | KPI ingest/parse, полоска pipeline, карточки **queue_parse_coverage** по фазам (`done★`, очередь) |
| **Parse-engine** | `PhasesWidget` (секция «Обогащение») | Ingest / Geo фазы: ВКЛ/ВЫКЛ, Run, очереди, активные runs, stop-all, clear queue |
| **Worker runners** | `WorkerRunnersWidget` | health ingest/parse демонов рядом с фазами |
| **Backfill V2** | `BackfillRunnerWidget` + `BackfillJobCard` | ingest raw; подсказка: parse → **Обогащение → Фазы** (не «карта готова» на `completed`) |
| **Realtime** | WS `phases-update` (`AdminGateway`, ~3s) | `overview` + последние `runs`; при завершении run — `pushMapSnapshot` |

Layout: `/admin` → секции **Система** → **Обогащение** → **Ingest** → **Backfill** (`adminWidgetRegistry.ts`).

## Частично / backlog

| Пункт | Статус |
|-------|--------|
| WS `phase-progress` (гранулярный прогресс тика/batch) | ❌ вместо этого `phases-update` (overview + runs, 3s) |
| `policy.concurrency` — параллельные run | ❌ один batch на фазу |
| `POST /replay` + `runEagerNow` в API | ⚠️ invalidate+catchUp; eager — worker / `worker:reparse:raw` |
| Rate-limit / debounce `minIntervalMs` в daemon | ⚠️ `intervalMs` per phase, debounce упрощён |
| Кириллица в подписях локальной карты | ⚠️ отдельно от PE (tilemaker `name:ru`) |

## Не в scope v1

- `parse:snap` / `parse:report` — вне pipeline (лаборатория).
- Селекторы `head/tail` в манифесте — только manual scope.

## Операторский маршрут после backfill

```text
Backfill completed (raw в БД)
  → /admin «Сводка» — queue_parse_coverage по catalog/llm/…
  → /admin «Parse-engine» — очереди, Run, runs
  → карта — после catalog (+ llm при enabled)
```

## Проверка «всё работает»

1. `npm run migration:run`
2. `npm run phase:manifest:import`
3. `npm run build` (shared, api, worker, web)
4. `npm run worker:dev` + ingest / backfill
5. Админка → **Сводка** → coverage `catalog` done★ растёт
6. Админка → **Parse-engine** → `llm` pending→done при enabled
7. `npm run worker:reparse:raw` — карта сбрасывается, catalog eager на всех raw
