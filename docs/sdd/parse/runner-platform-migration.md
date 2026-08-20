# Parse — Runner Platform Migration (Wave 4)

Статус: код готов, opt-in через `deployment.manifest.json` → `schedulingImpl=runner-platform` (см. [ADR-021](../../rfc/adr-021-manifest-env-ssot.md))
База: [ADR-016](../../adr-016-runner-platform.md), [SDD runner-platform](../runner-platform/README.md) · Индекс: [../README.md](../README.md)

Не путать с P1–P6 (`ParseWorkspace`, processor registry, semantic segmenter выше в этом же индексе) — это про парсинг **содержимого** сообщения. Wave 4 — про инфраструктуру **запуска** ingestParse-фаз поверх raw.

---

## Убрано: message-copy queue

Legacy `CoverageEnqueuer` копировал каждое raw-сообщение в `queue_parse_coverage` — отдельную запись на каждую scheduled-фазу. При N фазах — N копий на одно сообщение, плюс отдельная логика "перетасовки" очереди при cascade-reset.

Runner platform читает **raw как SSOT** + курсор на фазу (`IPhaseCoverageRepository`/`IPhaseRunRepository` уже дают "сколько обработано" без промежуточной очереди-копии). Cascade reset фазы — сдвиг курсора одним UPDATE, без переразбора очереди.

## Модель: реестр workload по фазам

| | Legacy (`IngestParseDaemonService`) | Runner platform (`ParseRunnerRegistry`) |
|---|---|---|
| Единица исполнения | `Map<phaseId, setInterval>` вручную | один `Workload` (`jobKernel`) на каждую enabled scheduled `ingestParse`-фазу |
| Реакция на вкл/выкл фазы в админке | ручной `refreshSchedules()` | `refresh()` каждые 15s пересобирает набор workload (`ParseRunnerRegistry.refresh`) |
| Пробуждение по событию | нет | `enqueueAll()` — Wave 6, `wireBusTrigger(bus, "RawMessageIngested", ...)` |

`ParseRunnerRegistry` и legacy `IngestParseDaemonService` взаимоисключающие в `createWorkerCompositionRoot.ts` — одна и та же `queue_parse_coverage`/`log_parse_phase_run` очередь, гонки нет.

## Файлы

| Файл | Роль |
|---|---|
| `application/parse/runner/parseRunnerRegistry.ts` | `ParseRunnerRegistry` — по одному `Workload` на фазу, `enqueueAll()` для Wave 6 |
| `application/parse/runner/parsePhaseWorkload.ts` | `createParsePhaseWorkload(deps, phase)` — workbook + workload на одну фазу, `emitProgress` с `phaseKey = "parse.<phase.id>"` |
| `application/phases/phaseOrder.ts` | `sortPhasesByOrder` — общий для legacy/новых раннеров порядок фаз |
| `application/phases/phaseRunner.ts` | `PhaseRunner.runDrain` — сама бизнес-логика батча (не менялась), обёрнута в `evaluate` |

## phaseKey

`phaseKey = "parse.<phase.id>"` — один workload = одна фаза, поэтому неоднозначности нет (в отличие от geo-enrich, где один workload крутит несколько фаз за тик).

## Chaining (Wave 6)

`wireBusTrigger(bus, "RawMessageIngested", { debounceMs: 250, onRoute: () => parseRunner.enqueueAll() })` — новое raw сообщение будит **все** активные phase-workload сразу, не дожидаясь их индивидуальных интервалов. Работает только когда `schedulingImpl=runner-platform` для parse (`ingestParseDaemon instanceof ParseRunnerRegistry`) — для legacy демона это no-op.

## Тесты

`parsePhaseWorkload.test.ts` — unit-покрытие `loadSlice`/`evaluate`/`emitProgress` (включая `phaseKey`). `parseRunnerRegistry.test.ts` — контракт `ParseRunnerRegistry`: старт создаёт workload на каждую enabled-фазу, `enqueueAll()` будит все зарегистрированные workload (Wave 6), `refresh()` останавливает workload для фаз, переставших быть enabled, и поднимает новые.
