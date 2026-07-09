# Tracking — Runner Platform Migration (Wave 3)

Статус: код готов, за флагом `TRACKING_RUNNER_PLATFORM_ENABLED` (default off)
База: [ADR-016](../../adr-016-runner-platform.md), [SDD runner-platform](../runner-platform/README.md) · Индекс: [../README.md](../README.md)

Это НЕ про алгоритм трекинга (nextgen-gravity, ADR-015) — про инфраструктурный контур запуска. Алгоритм не менялся: `loadDedupClosure`/`runIncrementalBatch` — те же функции, что использует legacy `TrackingRebuildDaemon`.

---

## До / после

| | Legacy (`TrackingRebuildDaemon`) | Runner platform (`createTrackingRunner`) |
|---|---|---|
| Тик | ручной `setInterval` | `jobKernel` (`schedule: hybrid`) |
| Курсор | инлайн SQL в классе демона | `CursorStore` → `readTrackingPipelineState`/`resetTrackingWatermark` |
| Control (pause/cancel) | инлайн проверка в демоне | `ctx.checkControl()` → `readTrackingRunControl` |
| Прогресс → WS | прямой вызов | `SignalEnvelope` через `trackingTelemetryBridge` |
| Пробуждение по событию | нет (только interval) | `wireBusTrigger(bus, "MessageParsed", ...)` (Wave 6) |

Таблицы (`state_track_pipeline`, `job_track_rebuild`) и SQL-порты общие — оба раннера читают одно и то же состояние, поэтому переключение флагом не теряет прогресс (см. `packages/worker/src/infrastructure/tracking/trackingPipelineStateRepository.ts`).

## Файлы

| Файл | Роль |
|---|---|
| `application/tracking/runner/trackingRunner.ts` | `createTrackingRunner(ds)` — workbook (`pipelineKey: "tracking"`, одна фаза `incremental-batch`) + workload |
| `application/tracking/runner/trackingRunnerContracts.ts` | `TrackingCursorSnapshot`/`TrackingRunnerSlice`/`TrackingRunnerArtifact` — типы cursor/slice/artifact |
| `application/tracking/runner/trackingMaterializationPorts.ts` | `createTrackingMaterialize(ds)` — запись результата батча в БД |
| `application/tracking/runner/trackingTelemetryBridge.ts` | `emitProgress` → `SignalEnvelope` с `phaseKey = "tracking.<stats.stage>"` |
| `application/tracking/trackingRebuildService.ts` | Разрезанный сервис: `loadDedupClosure` (point loading/cursor), `runIncrementalBatch` (phase orchestration + persistence), `countTrackingPipelineRemaining` (stats) — переиспользуются legacy и новым раннером |

## Cursor / control semantics

`loadSlice` каждый тик перечитывает `state_track_pipeline` из БД (не кэширует enabled/config) — конфигурация и `pause/cancel` могут поменяться из админки в любой момент, следующий тик должен их увидеть. `cursorStore.write` — формальность (no-op): реальный watermark персистится внутри `materialize` (`advanceTrackingWatermark`), `read()` всегда берёт актуальное состояние.

## phaseKey

Один pipeline `tracking`, одна workload-фаза (`incremental-batch`), но `phaseKey` в telemetry namespaced по `stats.stage` рантайма батча (`tracking.idle` / `tracking.done`), не по статичному id фазы — стадия батча меняется чаще, чем список фаз.

## Тесты

Платформенный уровень покрыт: `runtime/runner-platform/jobKernel.test.ts`, `runtime/workload/createWorkload.test.ts`, `runtime/workload/triggerLayer.test.ts`, `runtime/workload/wireBusTrigger.test.ts`. Доменный уровень: `application/tracking/runner/trackingTelemetryBridge.test.ts` (`phaseKey` namespacing, envelope passthrough). **Пробел:** нет unit-теста на сам `trackingRunner.ts` (`loadSlice`/`evaluate` с фейковыми `ds`-репозиториями, как у `parsePhaseWorkload.test.ts`) — сложнее из-за прямой зависимости от `DataSource`, задача `test-gates` (Wave 8). Regression-паритет legacy/новый раннер на golden fixtures — туда же, не выполнено отдельным прогоном на реальной нагрузке (см. ADR-016 "Последствия").
