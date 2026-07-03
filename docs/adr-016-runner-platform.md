# ADR-016: Runner platform — единый рантайм для tracking/parse/geo-enrich

Дата: 2026-07-02
Статус: **Принято** (Wave 1–6 в коде, за feature-флагами, legacy-раннеры взаимоисключающие)

Связано: [ADR-014 ODP](./adr-014-operational-domain-profile.md), [ADR-015 nextgen-gravity](./adr-015-data-association-reuse-and-locus.md), [SDD runner-platform](./sdd/runner-platform/README.md)

---

## Контекст

До этого ADR каждый домен (`tracking`, `parse`, `geo-enrich`) гонял свой демон: ручной `setInterval`, свой инлайн-SQL для курсора/lock/статуса, свой способ слать прогресс в WS. Общего между ними было много (schedule tick, lock, cursor read/advance, control pause/cancel, telemetry envelope), но код не переиспользовался — три копии одной и той же механики с разными багами.

Дополнительно: `parse` использовал message-copy queue (`CoverageEnqueuer` → `phase_coverage`), дублируя каждое сообщение в очередь для каждой фазы вместо курсора по raw SSOT.

## Решение

Общий раннер вынесен в **runner platform** — набор generic-модулей без доменного знания:

| Модуль | Файл | Назначение |
|---|---|---|
| `jobKernel` | `packages/worker/src/application/runtime/runner-platform/jobKernel.ts` | Собирает schedule + lock + cursor + `PipelineCallbacks` + telemetry в один тик |
| `cursorEngine` | `.../cursorEngine.ts` | Read/advance/reset курсора; форму курсора решает домен (`CursorStore<TCursor>`) |
| `scheduleEngine` | `.../scheduleEngine.ts` | interval/event/hybrid тик + `wake()` |
| `lockEngine` | `.../lockEngine.ts` | In-process mutex на `pipelineKey`, не даёт двум тикам одного pipeline пересечься |
| `telemetryBus` | `.../telemetryBus.ts` | Publish/subscribe для `SignalEnvelope<TArtifact>` |
| `runnerContracts` | `.../runnerContracts.ts` | Типы: `PipelineCallbacks`, `SignalEnvelope`, `SignalPolicy` (`durable/persist/ephemeral`) |

Домен подключается через `PipelineCallbacks<TCursor, TSlice, TArtifact>` = `{ loadSlice, evaluate, materialize, emitProgress? }` — это и есть `ingest -> run -> materialize` из исходного плана.

**Workbook/workload** (`packages/shared/src/domain/workbook/`, `packages/worker/src/application/runtime/workload/`) — декларативный слой поверх platform:

- `createWorkbook({ pipelineKey, phases, evaluate })` — чертёж конвейера, чистая функция `evaluate`, тестируется без runtime.
- `createWorkload({ workbook, io, schedule })` — связывает workbook с `jobKernel` + I/O-портами конкретного домена → возвращает `Workload` (по сути `JobKernel` + `descriptor`).
- `TriggerLayer` (`triggerLayer.ts`) — debounce + gate перед `workload.enqueue()`, источник (`bus | scheduler | manual | cli`) не важен для workload.
- `wireBusTrigger(bus, eventType, options)` — подписывает `TriggerLayer` на шину событий (Wave 6, хореография вместо оркестрации).

Код-first: без отдельного DSL/manifest-файла — workbook описывается TS-фабрикой и колбеком (решение `functional-composition`, зафиксировано пользователем).

## Миграция по доменам (waves)

| Wave | Домен | Файл раннера | Флаг | Статус |
|---|---|---|---|---|
| 3 | tracking | `application/tracking/runner/trackingRunner.ts` | `TRACKING_RUNNER_PLATFORM_ENABLED` | код готов, default off |
| 4 | parse | `application/parse/runner/parseRunnerRegistry.ts` | `PARSE_RUNNER_PLATFORM_ENABLED` | код готов, default off |
| 5 | geo-enrich | `application/geo-parse/runner/geoEnrichRunner.ts` | `GEO_ENRICH_RUNNER_PLATFORM_ENABLED` | код готов, default off |
| 6 | cross-context | `wireBusTrigger` в `createWorkerCompositionRoot.ts` | активен только когда соответствующий домен на новом раннере | код готов |

Легаси-раннер и новый раннер **взаимоисключающие** — выбор одного из двух в `createWorkerCompositionRoot.ts`, не параллельный запуск. Переключение — только флагом, без удаления старого кода (Gate D, до отдельного hard-cut в Wave 7).

## Отношение к ADR-014 (ODP)

`packages/worker/src/composition/odp/` (`odpManifest` + `odpResolve`) — **не новая сущность**, а первый срез существующего ODP (ADR-014) в контексте runner platform: сейчас это статический список `{ pipelineKey, runnerPlatformEnabled() }`, читающий те же feature-флаги, только для лога и будущего admin UI. Он **не управляет** конструированием раннеров (это по-прежнему делает `createWorkerCompositionRoot.ts`) и не пересекается с доменной частью ODP (`parser-rules`, `threatProfileRules`, `uiPresets` из `profile.manifest.json`). Дальнейшее слияние (пайплайн-конфигурация как часть `profile.manifest.json`) — отдельное решение, не в рамках этого ADR (см. [phase-d7](./sdd/odp/phase-d7-workbook-runner-integration.md)).

## Naming

`pipelineKey` (`tracking`/`parse`/`geo-enrich`) + `phaseKey` (`tracking.<stage>`, `parse.<phaseId>`, `geo-enrich.<phaseId>`) — единый неймспейс во всех `SignalEnvelope`, логах и telemetry. Убирает путаницу между parse-фазами и tracking-фазами, у которых раньше было общее слово «фаза» без контекста.

## Последствия

- Плюс: три домена гоняют один и тот же проверенный код планирования/лока/курсора/сигналинга; новый домен на runner platform — это только `PipelineCallbacks`, без переизобретения демона.
- Плюс: хореография вместо оркестрации (Wave 6) — новый переход `raw -> parse -> tracking -> geo-enrich` не требует правки центрального оркестратора, только `wireBusTrigger` на нужном событии.
- Минус (временный): пока флаги выключены по умолчанию, в кодовой базе одновременно живут legacy-демон и runner-platform-раннер на один и тот же домен — двойная поверхность до Wave 7 (удаление legacy).
- Не валидировано против прод-нагрузки — включение флагов требует отдельной проверки (Gate A–C) до дефолтного `true`.
