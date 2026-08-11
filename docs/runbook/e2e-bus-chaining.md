# Runbook — E2E bus chaining (raw → parse → tracking → geo)

База: [ADR-016](../adr-016-runner-platform.md) Wave 6 · [how-it-works.md](../domain/how-it-works.md)

---

## Предусловия

```powershell
$env:DEPLOY__runners__pipelines__parse__schedulingImpl="runner-platform"
$env:DEPLOY__runners__pipelines__geo-enrich__schedulingImpl="runner-platform"
$env:DEPLOY__runners__pipelines__tracking__schedulingImpl="runner-platform"
$env:WORKER__tracking__enabled="true"
npm run radar -- stack dev
```

---

## Цепочка

| Переход | Событие | Debounce |
|---------|---------|----------|
| raw → parse | `RawMessageIngested` | 250ms |
| parse → tracking | `MessageParsed` | 250ms |
| parse → geo | `MessageParsed` | 250ms |
| parse (дренирован) → tracking | `radar.parse.stabilized` (DSL) | 250ms |
| backfill (канал исчерпан) → parse | `ChannelBackfillCompleted` | — |

Polling (`hybrid schedule`) — резерв если событие потеряно. `PipelineStabilized` — доп. страховка на случай если единичный `MessageParsed` потерян/debounce съел последний тик (подробнее: [stability cascade](../domain/how-it-works.md#stability-cascade)).

---

## E2E шаги

1. Inject: `POST /api/admin/ingest/messages` или live Telegram
2. SQL parse: `mat_parse_event`, `mat_parse_location`
3. Obs triggers: `SELECT * FROM obs_trigger_counters`
4. Tracking: `mat_track`, `GET /api/map/tracks`
5. Geo: `job_geo_place_enrich`

---

## Диагностика

| Симптом | Fix |
|---------|-----|
| Parse не будится | `DEPLOY__runners__pipelines__parse__schedulingImpl=runner-platform` |
| Tracking молчит | tracking `schedulingImpl` + `WORKER__tracking__enabled=true` |
| Trigger count = 0 | `infra.obs.mode` ≠ noop (manifest) |
| Duplicate parse | legacy + runner-platform одновременно — запрещено |

---

## Step run / isolate

| Сценарий | Как | Ожидание |
|----------|-----|----------|
| **Run from step** | Admin/CLI → `StepRunRequested{stepId}` (напр. `parse`) | только целевой шаг; upstream не трогаем |
| **Isolate** | тот же запрос с `meta.isolate=true` | `mat_*` пишется; domain emits не в RMQ; `log_step_run.suppressed_emits` + `downstreamStepIds`; tracking не будится |
| **Live cascade** | inject message без isolate | ingest → parse → `MessageParsed` → tracking |
| **Backfill cascade** | backfill job → `ChannelBackfillCompleted` | parse снимает inProgress / дренирует канал |
| **Reset from step** | `StepResetRequested{stepId, cascade, dryRun}` | `dryRun` = counts без изменений; cascade = потомки по графу emits→trigger |

Топология ключей: [pipeline-triggers.md](../reference/pipeline-triggers.md). Хуки: [pipeline-hooks-and-events.md](../domain/pipeline-hooks-and-events.md).

---

## CLI smoke

```powershell
npm run radar -- ingest backfill -- --all-bindings --batch-size=10
npm run radar -- parse run
npm run radar -- pipeline status
```

Acceptance: trigger counters > 0, workloads drain, нет duplicate parse; isolate-прогон не будит tracking.
