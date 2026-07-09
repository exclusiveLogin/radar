# Runbook — Runner Platform

База: [README.md](./README.md) · [ADR-016](../../adr-016-runner-platform.md)

---

## Включение раннера на runner platform

Legacy и runner-platform раннер одного домена **взаимоисключающие** — переключение через `deployment.manifest.json` → `runners.pipelines[].schedulingImpl` (см. [ADR-021](../../rfc/adr-021-manifest-env-ssot.md)).

```json
// deployment.manifest.json — пример для tracking
{ "pipelineKey": "tracking", "schedulingImpl": "runner-platform" }
```

```powershell
# env override (DEPLOY__)
$env:DEPLOY__runners__pipelines__tracking__schedulingImpl="runner-platform"
$env:DEPLOY__runners__pipelines__parse__schedulingImpl="runner-platform"
$env:DEPLOY__runners__pipelines__geo-enrich__schedulingImpl="runner-platform"

npm run worker:dev
```

Проверка: в логе воркера при старте — `[odp] <pipelineKey> → runner-platform (<label>)` (см. `odpResolve()` в `createWorkerCompositionRoot.ts`).

**Не включать в проде без прогона Gate A–C** (ADR-016) — новые раннеры не валидированы против прод-нагрузки.

## Откат (rollback)

Просто вернуть `schedulingImpl=legacy` в manifest (или снять `DEPLOY__` override) и перезапустить воркер — легаси-демон стартует, как раньше. Курсоры/таблицы состояния общие (`state_track_pipeline`, `queue_parse_coverage`/`log_parse_phase_run`, `job_geo_place_enrich`) — переключение не теряет прогресс.

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

## Pause / Resume / Stop (jobKernel)

Runner platform использует кооперативный control в `jobKernel`:

| Операция | API / механизм | Эффект |
|----------|----------------|--------|
| **Pause** | `POST /admin/tracking/pause` (tracking) | `kernel.pause()` — tick не вызывает evaluate |
| **Resume** | `POST /admin/tracking/resume` | `kernel.resume()` + wake scheduler |
| **Stop** | Shutdown worker / `kernel.stop()` | Schedule останавливается, cursor сохранён в БД |
| **Cancel run** | Admin phase cancel | Текущий run помечается cancelled, cursor не advance |

Legacy-демоны используют те же control-таблицы (`readTrackingRunControl`, phase definitions).

```powershell
# Проверка pause/resume (tracking)
curl -X POST http://127.0.0.1:3000/api/admin/tracking/pause
curl -X POST http://127.0.0.1:3000/api/admin/tracking/resume
```

Obs write-path фиксирует status workload: `running` → `paused` → `running` в `obs_workloads`.

## ODP badges (runtime discovery)

При старте worker логирует и пишет в `obs_hosts.odp_runtime`:

```text
[odp] tracking → legacy (NextGen track rebuild …)
[odp] parse → runner-platform (ingestParse scheduled phases …)
[odp] geo-enrich → legacy (geoParse scheduled phases …)
```

| Badge | Значение |
|-------|----------|
| `legacy` | Старый setInterval-демон |
| `runner-platform` | jobKernel + workbook/workload |

Источник: `odpResolve(deploymentManifest)` — читает `deployment.manifest.json` → `schedulingImpl`.

Admin UI: Workbook observability widget + Worker runners probe. Runtime snapshot: `GET /obs/v1/runtime/snapshot`.

## Config-stale (известный пробел)

`workloadStatusSchema` (`packages/shared/src/schemas/admin/workbook.ts`) резервирует статус `"config-stale"` для случая "конфигурация фазы поменялась после того, как курсор её уже прошёл" (например, изменили правила enrichment после того, как фаза `geo-dadata` уже продвинула курсор дальше этой точки). **Детектор пока не реализован** — `workbook-admin.service.ts` всегда возвращает `running/paused/waiting`, никогда `config-stale`. Нужен отдельный design (сравнение `updatedAt` конфигурации фазы с `watermark` курсора) — не реализовывать без отдельного согласования (см. правило "не закладывать usecases без обсуждения").

## Наблюдаемость (Admin/Web UI)

`GET /admin/workbook/observability` → `WorkbookObservabilityResponse` (`registry` / `activeWorkloads` / `runHistory`), рендерится виджетом `packages/web/src/admin/widgets/WorkbookObservabilityWidget.tsx`. Один и тот же ответ для всех трёх `pipelineKey`, независимо от того, какой раннер (legacy/runner-platform) сейчас активен для домена — источник данных API это существующие `TrackingAdminService`/`PhasesAdminService`, а не runtime internals воркера.

## Cross-context chaining (Wave 6) — диагностика

Если новый event-driven wake-up не срабатывает (например, `parse` не будится сразу после `RawMessageIngested`):

1. Проверить, что `schedulingImpl=runner-platform` для parse — `wireBusTrigger` подключается в `createWorkerCompositionRoot.ts` только для runner-platform раннера, для legacy-демона это no-op (он продолжает жить на своём `setInterval`).
2. Debounce окна — `250ms` (см. `wireBusTrigger(bus, ..., { debounceMs: 250 })`) — несколько событий подряд коалесцируются в один `enqueue()`.
3. Polling (`schedule: { mode: "hybrid", intervalMs }`) — резервный путь всегда работает, даже если событие потеряно: воркер догонит на следующем интервальном тике.

## Migration checklist (домен на runner platform)

1. Убедиться, что legacy-демон и новый раннер читают одни и те же таблицы/очереди (без дублирования состояния).
2. Включить `schedulingImpl=runner-platform` в dev/staging, прогнать Gate A (functional correctness) на golden fixtures домена.
3. Прогнать Gate B (DB/poller/WS consistency) — сверить `activeWorkloads`/`runHistory` в Admin UI до/после переключения.
4. Прогнать Gate C (operability: pause/resume/reset/restart) по таблице выше.
5. Держать `schedulingImpl=legacy` в проде до отдельного go-решения — Wave 7 (удаление legacy) стартует только после подтверждённого cutover по всем трём доменам.
