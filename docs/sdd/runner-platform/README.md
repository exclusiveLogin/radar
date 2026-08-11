# Runner Platform — SDD

Статус: **Wave 1–6 в коде, за feature-флагами** (2026-07-02) · Wave 7 (legacy removal) заблокирован до прод-cutover
База: [ADR-016](../../adr-016-runner-platform.md) · Индекс SDD: [../README.md](../README.md) · Runbook: [runbook.md](./runbook.md) · Observability: [observability-daemon.md](./observability-daemon.md) · Release checklist: [release-checklist.md](./release-checklist.md)

Cross-context SDD — применяется одинаково к `tracking`, `parse`, `geo-enrich`. Доменные детали миграции каждого — в `docs/sdd/tracking/runner-platform-migration.md` и `docs/sdd/parse/runner-platform-migration.md`.

---

## Глоссарий

| Термин | Определение | Файл |
|---|---|---|
| **workbook** | Декларативный чертёж конвейера: `{ pipelineKey, phases, evaluate }`. Не исполняется сам — только описание + чистая функция. | `packages/shared/src/domain/workbook/createWorkbook.ts` |
| **workload** | Работающий экземпляр workbook: `jobKernel` + I/O-порты (`cursorStore`, `loadSlice`, `materialize`, `emitProgress`). То, что реально тикает по расписанию. | `packages/worker/src/application/runtime/workload/createWorkload.ts` |
| **payload** | Данные, захваченные `loadSlice(cursor)` на вход `evaluate` — `TSlice`. Форму решает домен. | `runnerContracts.ts` (`LoadSlice`) |
| **eval** | Чистая молотилка: `(slice, ctx) => { artifact, nextCursor }`. Не знает про schedule/lock/DB — только вход/выход. Тестируется без runtime. | `workbookContracts.ts` (`WorkbookEvalFn`) |
| **materialization** | Побочные артефакты после `evaluate` — запись в БД/файлы через `Materialize<TArtifact>`. Раннер платформы не знает, что внутри — это доменный колбек. | `runnerContracts.ts` (`Materialize`) |
| **signaling** | Способ сообщить наружу о прогрессе — типизированный `SignalEnvelope<TPayload>` с флагами `durable/persist/ephemeral`. Единственная форма, в которой platform говорит с внешним миром (WS/poller/snapshot). | `runnerContracts.ts` (`SignalEnvelope`, `SignalPolicy`) |
| **trigger layer** | Debounce + gate перед `workload.enqueue()`. Не знает про workbook — только вызывает `onRoute()`. | `workload/triggerLayer.ts` |
| **pipelineKey** | Неймспейс домена: `tracking` \| `parse` \| `geo-enrich`. | — |
| **phaseKey** | Неймспейс фазы внутри домена: `<pipelineKey>.<phaseId>` (`tracking.cluster`, `parse.ingest-channel`, `geo-enrich.geo-dadata`). | — |
| **stability scope** | Ключ race-safe claim'а «весь pipeline дренирован» — `pipeline:<pipelineKey>` или `channel-backfill:<channelId>`. Персист в `state_pipeline_stability`. | `runner-platform/stabilityEngine.ts` |

---

## Слоение (ODP → workbook domain → runner platform)

```text
┌──────────────────────────────────────────────────────────────────┐
│ ODP (Operational Domain Profile, ADR-014)                        │
│  — "какой мир мониторим": активные event-типы, parser-rules,     │
│    threat-profile правила, UI presets                            │
│  — odpResolve(): читает feature-флаги доменов → { pipelineKey,   │
│    runtime: "runner-platform" | "legacy" } для лога/admin UI     │
│  — НЕ видит internals runner platform, НЕ строит workload        │
└───────────────────────────┬────────────────────────────────────--┘
                             │ читает флаги, не управляет конструированием
┌───────────────────────────▼────────────────────────────────────--┐
│ Workbook domain (packages/shared/src/domain/workbook/)           │
│  — createWorkbook({ pipelineKey, phases, evaluate })              │
│  — код-first чертёж + чистый eval, без Node.js зависимостей       │
│  — НЕ знает про jobKernel/schedule/lock/DB                        │
└───────────────────────────┬────────────────────────────────────--┘
                             │ createWorkload(workbook, io, schedule)
┌───────────────────────────▼────────────────────────────────────--┐
│ Runner platform (packages/worker/src/application/runtime/)       │
│  — jobKernel: schedule + lock + cursor + callbacks + telemetry   │
│  — generic, НЕ знает доменных типов (tracking/parse/geo-enrich)  │
│  — domain подключается только через PipelineCallbacks             │
└────────────────────────────────────────────────────────────────--┘
```

Направление зависимостей — сверху вниз по владению конфигурацией, но **исполнение** идёт снизу вверх: `jobKernel.tick()` вызывает `workbook.evaluate`, которое читает конфигурацию, разрешённую через ODP (feature-флаг), но сама platform ODP не импортирует.

## Dataflow: trigger → ingest → materialize → signaling

```text
event (bus | scheduler | manual | cli)
   │
   ▼
TriggerLayer.fire(source) ──[debounce/gate]──▶ onRoute() = workload.enqueue()
   │
   ▼
jobKernel.tick()
   │  loadSlice(cursor)         = ingest
   │  evaluate(slice, ctx)      = eval (чистая молотилка)
   │  materialize(artifact)     = materialize (side-эффекты, БД)
   │  cursorEngine.advance(...)
   │  emitProgress(envelope)    = signaling (WS/poller/snapshot по SignalPolicy)
   ▼
следующий pipeline подписан на событие через wireBusTrigger → свой TriggerLayer
```

Никакого центрального оркестратора между доменами — только хореография сигналами (Wave 6). `raw -> parse`, `mat_parse_event -> tracking`, `mat_parse_event -> geo-enrich` — каждый переход это `wireBusTrigger(bus, eventType, { onRoute: () => nextWorkload.enqueue() })`.

### Cascade: stability-based wake (дополняет event-per-message chaining)

Событие на каждое сообщение (`MessageParsed`) не гарантирует, что **весь** pipeline (все фазы, все реплики) реально дренирован. Для этого `jobKernel` получил `onBusy`/`onIdle` хуки в `JobKernelObsPort` — сам не знает про RMQ, просто сообщает composition root о переходах busy↔idle. App-обвязка (`application/cascade/pipelineStabilityCascade.ts`) на `onIdle` перепроверяет персист (`hasPendingWork`) и, если пусто, атомарно клеймит `stabilityEngine.reportIdle(scope)` — единственный победитель гонки реплик публикует `DomainEvent`:

| Scope | Событие | Кто публикует | Кто будит |
|---|---|---|---|
| `pipeline:parse` | `PipelineStabilized{parse}` | любая реплика parse-workload, выигравшая claim | `tracking` (`wireParseStabilizedTrigger`) |
| `pipeline:geo-enrich` | `PipelineStabilized{geo-enrich}` | реплика geo-enrich | — (пока без подписчика; задел для будущих geo-derived pipeline) |
| `channel-backfill:<id>` | `ChannelBackfillCompleted` | `BackfillDaemonService` при `historyExhausted` без других runnable job по каналу | `parse` (`channelBackfillCompletedSubscriber` снимает `inProgress`) |

Подробности и код: [how-it-works.md#stability-cascade](../../domain/how-it-works.md#stability-cascade).

---

## Инварианты

| # | Инвариант |
|---|---|
| 1 | Один и тот же `pipelineKey` не может тикать в двух местах одновременно — `lockEngine` в `jobKernel` гарантирует это in-process; legacy/новый раннер одного домена взаимоисключающие на уровне composition root (флаг), не параллельные. |
| 2 | `evaluate` — чистая функция без side-эффектов (не пишет в БД, не шлёт WS) — все side-эффекты только через `materialize`/`emitProgress`. |
| 3 | Курсор — единственный источник "докуда обработано"; нет отдельной message-copy очереди дублирующей raw (см. Wave 4 — убран `CoverageEnqueuer`). |
| 4 | `SignalEnvelope.pipelineKey`/`phaseKey` обязателен и namespaced — нет "голых" имён фаз без домена. |
| 5 | Runner platform не импортирует workbook/ODP типы; ODP не импортирует runner platform internals — зависимость только через feature-флаг функцию (`is...RunnerPlatformEnabled()`). |
| 6 | Cursor reset — каскадный через SQL (сдвиг курсора), не через переразбор/shuffle очереди. |

## Anti-patterns (не делать)

| # | Anti-pattern | Почему |
|---|---|---|
| 1 | Класть доменную логику (SQL, alg) внутрь `jobKernel`/`scheduleEngine`/`lockEngine` | Ломает переиспользование между tracking/parse/geo-enrich — вернёт три копии кода |
| 2 | Вызывать `materialize`/`emitProgress` из середины `evaluate` | `evaluate` должен быть тестируем как чистая функция вход→выход |
| 3 | Заводить новый DSL/manifest-формат для workbook | Решение уже зафиксировано — код-first (`functional-composition`) |
| 4 | Копировать сообщения в per-phase очередь вместо курсора по SSOT | Wave 4 явно убрал этот паттерн (`CoverageEnqueuer`) |
| 5 | Оркестратор, который дергает несколько workload по цепочке напрямую | Используй `wireBusTrigger` — хореография, не оркестрация |
| 6 | Включать `schedulingImpl=runner-platform` в проде без прогона Gate A–C | Не валидировано против прод-нагрузки (см. ADR-016, конфиг — [ADR-021](../../rfc/adr-021-manifest-env-ssot.md)) |

---

## Test coverage

| Слой | Файл | Что проверяет |
|---|---|---|
| Platform | `runtime/runner-platform/jobKernel.test.ts` | cursor transitions, pause/resume, coalescing тиков, durable replay |
| Platform | `runtime/workload/createWorkload.test.ts`, `triggerLayer.test.ts` | биндинг workbook↔jobKernel, debounce/gate |
| Platform | `runtime/workload/wireBusTrigger.test.ts` | подписка на bus-событие → debounced route |
| Tracking | `tracking/runner/trackingTelemetryBridge.test.ts` | `phaseKey` namespacing (`tracking.<stage>`) |
| Parse | `parse/runner/parsePhaseWorkload.test.ts`, `parseRunnerRegistry.test.ts` | `phaseKey`, dynamic add/remove workload, `enqueueAll()` |
| Geo-enrich | `geo-parse/runner/geoEnrichRunner.test.ts` | dadata→nominatim gating, run-id reuse, `phaseKey` |
| ODP | `composition/odp/odpResolve.test.ts` | flag → runtime mapping |
| API (contract) | `workbook-admin/workbook-admin.service.test.ts` | `workbookObservabilityResponseSchema` соответствие, registry/activeWorkloads/runHistory mapping |
| Stability | `runner-platform/stabilityEngine.test.ts` | race-safe claim: N параллельных `reportIdle`, ровно один winner |
| Cascade | `application/cascade/cascadeChains.test.ts` | `PipelineStabilized`/`ChannelBackfillCompleted` e2e через fake transport (live + backfill chain) |

Regression parity legacy/runner-platform на golden fixtures и integration-прогон `raw -> parse -> tracking -> geo-enrich` — не выполнены (Wave 8, `test-gates`), см. пробелы в `tracking/runner-platform-migration.md`.

## Конфигурация runner-platform (ADR-021)

| Manifest path | Pipeline | Default |
|---|---|---|
| `runners.pipelines[].schedulingImpl` | tracking | `legacy` |
| `runners.pipelines[].schedulingImpl` | parse | `legacy` |
| `runners.pipelines[].schedulingImpl` | geo-enrich | `legacy` |

Env override: `DEPLOY__runners__pipelines__{pipelineKey}__schedulingImpl=runner-platform`.
Операции (enable/reset/rollback) — [runbook.md](./runbook.md), канон — [ADR-021](../../rfc/adr-021-manifest-env-ssot.md).
