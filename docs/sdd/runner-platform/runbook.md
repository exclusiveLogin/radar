# Runbook — Runner Platform

База: [README.md](./README.md) · [ADR-016](../../adr-016-runner-platform.md)

---

## Включение раннера на runner platform

Legacy и runner-platform раннер одного домена **взаимоисключающие** — переключение только флагом в `createWorkerCompositionRoot.ts`, оба читают одни и те же БД-таблицы/очереди, гонки нет.

```powershell
# tracking
$env:TRACKING_RUNNER_PLATFORM_ENABLED="true"
# parse
$env:PARSE_RUNNER_PLATFORM_ENABLED="true"
# geo-enrich
$env:GEO_ENRICH_RUNNER_PLATFORM_ENABLED="true"

npm run worker:dev
```

Проверка: в логе воркера при старте — `[odp] <pipelineKey> → runner-platform (<label>)` (см. `odpResolve()` в `createWorkerCompositionRoot.ts`).

**Не включать в проде без прогона Gate A–C** (ADR-016) — новые раннеры не валидированы против прод-нагрузки.

## Откат (rollback)

Просто снять флаг (`=false` или unset) и перезапустить воркер — легаси-демон стартует, как раньше. Курсоры/таблицы состояния общие (`tracking_pipeline_state`, `phase_coverage`/`phase_runs`, `place_enrichment_jobs`) — переключение не теряет прогресс.

## Enable / Reset / Rebuild — не поменялись

Раннер на runner platform читает **те же** control-таблицы, что и legacy-демон — существующие admin-команды и API работают одинаково независимо от того, какой раннер сейчас активен:

| Операция | CLI | Admin API | Работает на |
|---|---|---|---|
| Tracking enable/disable | `tracking enable -- --on\|--off` | `PATCH /admin/tracking/enabled` | legacy + runner-platform |
| Tracking rebuild | `tracking rebuild -- --since=…` | `POST /admin/tracking/rebuild` | legacy + runner-platform |
| Tracking reset | `tracking reset` | `POST /admin/tracking/reset` | legacy + runner-platform (`cursorStore.reset` → `resetTrackingWatermark`) |
| Tracking pause/resume | — | `POST /admin/tracking/pause\|resume` | legacy + runner-platform (`readTrackingRunControl`) |
| Parse phase enable/disable | — | Admin → Фазы | legacy + runner-platform (`phaseDefinitions`) |
| Geo-enrich phase enable/disable | — | Admin → Фазы | legacy + runner-platform (`phaseDefinitions`) |

Cursor reset — каскадный: смена watermark/флага в БД, без переразбора очереди (Wave 3/4 инвариант).

## Config-stale (известный пробел)

`workloadStatusSchema` (`packages/shared/src/schemas/admin/workbook.ts`) резервирует статус `"config-stale"` для случая "конфигурация фазы поменялась после того, как курсор её уже прошёл" (например, изменили правила enrichment после того, как фаза `geo-dadata` уже продвинула курсор дальше этой точки). **Детектор пока не реализован** — `workbook-admin.service.ts` всегда возвращает `running/paused/waiting`, никогда `config-stale`. Нужен отдельный design (сравнение `updatedAt` конфигурации фазы с `watermark` курсора) — не реализовывать без отдельного согласования (см. правило "не закладывать usecases без обсуждения").

## Наблюдаемость (Admin/Web UI)

`GET /admin/workbook/observability` → `WorkbookObservabilityResponse` (`registry` / `activeWorkloads` / `runHistory`), рендерится виджетом `packages/web/src/admin/widgets/WorkbookObservabilityWidget.tsx`. Один и тот же ответ для всех трёх `pipelineKey`, независимо от того, какой раннер (legacy/runner-platform) сейчас активен для домена — источник данных API это существующие `TrackingAdminService`/`PhasesAdminService`, а не runtime internals воркера.

## Cross-context chaining (Wave 6) — диагностика

Если новый event-driven wake-up не срабатывает (например, `parse` не будится сразу после `RawMessageIngested`):

1. Проверить, что `PARSE_RUNNER_PLATFORM_ENABLED=true` — `wireBusTrigger` подключается в `createWorkerCompositionRoot.ts` только для runner-platform раннера, для legacy-демона это no-op (он продолжает жить на своём `setInterval`).
2. Debounce окна — `250ms` (см. `wireBusTrigger(bus, ..., { debounceMs: 250 })`) — несколько событий подряд коалесцируются в один `enqueue()`.
3. Polling (`schedule: { mode: "hybrid", intervalMs }`) — резервный путь всегда работает, даже если событие потеряно: воркер догонит на следующем интервальном тике.

## Migration checklist (домен на runner platform)

1. Убедиться, что legacy-демон и новый раннер читают одни и те же таблицы/очереди (без дублирования состояния).
2. Включить флаг в dev/staging, прогнать Gate A (functional correctness) на golden fixtures домена.
3. Прогнать Gate B (DB/poller/WS consistency) — сверить `activeWorkloads`/`runHistory` в Admin UI до/после переключения.
4. Прогнать Gate C (operability: pause/resume/reset/restart) по таблице выше.
5. Держать флаг off в проде до отдельного go-декишена — Wave 7 (удаление legacy) стартует только после подтверждённого cutover по всем трём доменам.
