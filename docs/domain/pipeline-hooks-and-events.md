# Pipeline hooks and events

Словарь точек расширения runner/step и доменных/системных событий шины.  
Топология триггеров (кто publishes / consumes по ключу) — генерируется: [../reference/pipeline-triggers.md](../reference/pipeline-triggers.md).

---

## Kernel hooks (`JobKernelObsPort`)

Файл: `packages/worker/.../runner-platform/jobKernel.ts`.

| Hook | Когда | Типичный consumer |
|------|-------|-------------------|
| `onTickStart` | начало тика (после lock) | workload obs |
| `onTickEnd` | конец тика (empty / success / error) | workload obs |
| `onMaterialize` | после `materialize(artifact)` | counters |
| `onBusy` | тик нашёл работу | `pipelineStabilityCascade` → `reportBusy` |
| `onIdle` | пустой слайс | cascade → `reportIdle` → возможно `PipelineStabilized` |
| `onRunning` / `onPaused` / `onStopped` | lifecycle kernel | obs UI |

Склейка портов: `mergeJobKernelObs`.

---

## Step hooks / journal

Файл: `StepRunner` + `log_step_run`.

| Сигнал | Смысл |
|--------|--------|
| `onStepStarted` ≈ `StepStarted` | шаг принял trigger, run открыт |
| `onStepDrained` ≈ `StepDrained` | run завершён успешно |
| `onStepFailed` ≈ `StepFailed` | run упал (reason в payload) |
| `onSuppressedEmit` | isolate: domain emit не ушёл; в journal `suppressed_emits[{key, downstreamStepIds}]` |

Lifecycle-ключи (`radar.step.started|drained|failed`) **проходят egress даже при isolate**.

---

## Системные события

| Type | Routing key | Кто эмитит | Кто потребляет |
|------|-------------|------------|----------------|
| `SystemInit` | `radar.system.init` | worker boot | `ingest-live` (lane=live) |
| `SystemDrain` | `radar.system.drain` | shutdown | (drain handlers) |
| `StepRunRequested` | `radar.step.run.requested` | admin / CLI | целевой step (`payload.stepId`) |
| `StepResetRequested` | `radar.step.reset.requested` | admin / CLI | reset cascade |
| `StepStarted` | `radar.step.started` | StepRunner | obs / topology UI |
| `StepDrained` | `radar.step.drained` | StepRunner | obs / topology UI |
| `StepFailed` | `radar.step.failed` | StepRunner | obs / topology UI |

Фабрики: `packages/shared/src/domain/pipeline/step/systemEvents.ts`.

---

## Доменные события (хореография)

| Событие | Эмитит | Потребляет |
|---------|--------|------------|
| `RawMessageIngested` | ingest-live / ingest-backfill | parse |
| `ChannelBackfillCompleted` | ingest-backfill | parse |
| `MessageParsed` | parse | tracking (+ geo request path) |
| `PipelineStabilized` → `radar.parse.stabilized` | stability cascade (DSL parse.emits) | tracking (подписка на ключ, без payload-gate) |
| `radar.geo.enrich.request` | admin/CLI / geo queue | geo-enrich |

Полный список ключей и gates — в generated reference.

---

## См. также

- SDD шагов: [../sdd/pipeline-steps/README.md](../sdd/pipeline-steps/README.md)
- How it works: [how-it-works.md](./how-it-works.md#pipeline-steps-flow)
- E2E: [../runbook/e2e-bus-chaining.md](../runbook/e2e-bus-chaining.md)
