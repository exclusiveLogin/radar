# Release checklist & DoD — Runner Platform

База: [README.md](./README.md) · [runbook.md](./runbook.md) · [ADR-016](../../adr-016-runner-platform.md)

Текущий статус (2026-07-02): **код готов для всех 3 доменов (Wave 1–6), флаги default off, cutover в проде не проводился.** Wave 7 (legacy removal) заблокирован до прохождения этого чеклиста в проде.

---

## Definition of Done — Wave 1–6 (сделано)

- [x] `jobKernel`/`cursorEngine`/`scheduleEngine`/`lockEngine`/`telemetryBus`/`runnerContracts` — реализованы, unit-покрыты (`jobKernel.test.ts`).
- [x] `workbook`/`workload`/`triggerLayer` — реализованы, unit-покрыты (`createWorkload.test.ts`, `triggerLayer.test.ts`).
- [x] Tracking/Parse/Geo-enrich на runner platform за флагом, алгоритм не изменён.
- [x] Wave 6 chaining (`wireBusTrigger`) — реализован, unit-покрыт (`wireBusTrigger.test.ts`), активируется только для доменов на runner platform.
- [x] `pipelineKey`/`phaseKey` namespacing — во всех `SignalEnvelope` трёх доменов, unit-подтверждено.
- [x] ODP-срез (`odpManifest`/`odpResolve`) — лог рантайма при старте.
- [x] Admin/Web UI Workbook Observability — `GET /admin/workbook/observability`, contract-тест (`workbook-admin.service.test.ts`).
- [x] SDD-пакет: [ADR-016](../../adr-016-runner-platform.md), этот README, [tracking](../tracking/runner-platform-migration.md)/[parse](../parse/runner-platform-migration.md) миграции, [ODP D7](../odp/phase-d7-workbook-runner-integration.md).

## Известные пробелы (не блокируют Wave 1-6, блокируют Wave 7)

| Пробел | Где | Риск |
|---|---|---|
| Нет unit-теста на `trackingRunner.ts` целиком (только на `trackingTelemetryBridge.ts`) | tracking | средний — `loadSlice`/`evaluate` не покрыты изолированно, только через реальный `DataSource` |
| Нет прод/staging-прогона под реальной нагрузкой | все 3 домена | высокий — Gate A-C не пройдены на практике |
| `config-stale` статус задекларирован в схеме, детектор не реализован | Admin UI | низкий — не мешает текущим фичам, просто пока не показывается |
| Нет end-to-end интеграционного теста `raw -> parse -> tracking -> geo-enrich` через реальную шину событий | cross-context | средний — Wave 6 chaining проверен только на уровне unit (`wireBusTrigger.test.ts`), не end-to-end |

## Почему не отдельный "regression parity" набор тестов

Legacy и runner-platform раннер каждого домена вызывают **одни и те же** чистые функции бизнес-логики (`runIncrementalBatch`/`loadDedupClosure` для tracking, `PhaseRunner.runDrain` для parse/geo-enrich) — алгоритм не копировался и не переписывался. Существующие golden-fixture тесты алгоритма (ADR-015 GF-01…GF-10, тесты `PhaseRunner`) уже покрывают корректность самого алгоритма независимо от раннера. Дублировать их под новым раннером означало бы тестировать ту же функцию дважды. То, что реально отличается между legacy/runner-platform — **scheduling/control контракт** (skip-if-active, stale-run recovery, pause/cancel) — это и есть то, что покрыто новыми unit-тестами (`parsePhaseWorkload.test.ts`, `geoEnrichRunner.test.ts`, `parseRunnerRegistry.test.ts`).

---

## Cutover checklist (на каждый домен, по одному за раз)

1. **Staging**: включить флаг домена, прогнать реальный трафик (или replay) минимум 24ч.
2. **Gate A (correctness)**: сверить результат обработки (tracks/parsed_events/enriched places) — идентичен снятому до переключения baseline.
3. **Gate B (consistency)**: Admin UI (`Workbook Observability`) — `activeWorkloads`/`runHistory` отражают реальное состояние, WS не рассинхронизирован с БД.
4. **Gate C (operability)**: вручную прогнать pause → resume → reset → restart процесса — раннер должен восстановиться без потери курсора (см. таблицу в [runbook.md](./runbook.md#enable--reset--rebuild--не-поменялись)).
5. **Gate D (rollback)**: снять флаг — legacy демон должен подхватить то же состояние без ручного вмешательства (проверить на staging перед прод).
6. Только после 1–5 — включать флаг в проде, по одному домену, с мониторингом (лог `[odp] <pipelineKey> → runner-platform`).

## Порядок доменов (рекомендация)

`parse` → `geo-enrich` → `tracking` (по возрастанию критичности бизнес-логики: tracking — самый чувствительный к точности вывод продукта).

## После прод-cutover всех трёх доменов → разблокируется Wave 7

Только тогда: удалить `TrackingRebuildDaemon`/`IngestParseDaemonService`/`PlaceEnrichmentDaemonService` legacy-классы, feature-флаги, ветвление `instanceof` в `createWorkerCompositionRoot.ts`. Отдельная задача, не в этой сессии.
