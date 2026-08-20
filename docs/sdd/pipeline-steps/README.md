# Pipeline Steps — SDD

Статус: **в коде (волны 0–5, 7–9)** · карта админки (волна 6) — отдельно  
База: [ADR-028](../../rfc/adr-028-infra-pipeline-manifests.md) · [ADR-025](../../rfc/adr-025-unified-pipeline.md) · индекс: [../README.md](../README.md)

---

## Модель (2 строки)

Шаг = `trigger.on[]` → evaluate/materialize → `emits[]`. Цепочки не зашиты в composition: ребро появляется, когда чей-то emit совпал с чьим-то trigger.

Единственная точка влияния на соседей — **egress gate** (`isolate` глушит публикацию, не исполнение).

```text
pipeline.manifest.json
  └─ step { id, trigger, phases?, emits, resets? }
       │
       ▼
StepTriggerRouter ──[lane / isolate / stepId]──▶ StepRunContext
       │
       ▼
StepRunner (фазы scope) → materialize → StepEgressGate → RMQ / bus
       │                                      │
       └─ log_step_run ◀──────────────────────┘ suppressed_emits
```

---

## Инварианты

| # | Инвариант |
|---|-----------|
| 1 | Новый шаг = правка только `pipeline.manifest.json` (без composition wiring) |
| 2 | Emit вне `emits[]` → ошибка конфигурации (`StepEgressGate`) |
| 3 | `isolate: true` пишет в `mat_*`, domain emits не уходят, lifecycle (`StepStarted/Drained/Failed`) проходит |
| 4 | `resets.handler` ∈ `{parse,geo,tracking,ingest}` — реестр в `stepResetRegistry` |
| 5 | Граф связен: contract-тест на реальном манифесте |

---

## Lane / isolate / reset

| Механика | Где | Поведение |
|----------|-----|-----------|
| **lane** | ingress `accepts.lane` | `meta.lane` → `payload.ingestMode` → `live` |
| **isolate** | ingress + egress | ingress: только target `stepId`; egress: suppress domain + `downstreamStepIds` в journal |
| **reset cascade** | `cascadeResetOrder` | потомки с `resets.handler` сначала (DFS post-order) |

---

## Слои

| Слой | Ответственность | Не знает |
|------|-----------------|----------|
| `pipeline.manifest` | WHAT flows (steps + phases) | hosts / RMQ URL |
| `infra.manifest` | WHERE runs | step topology |
| `StepTriggerRouter` | подписка + gates | фазы / SQL |
| `StepRunner` | run + journal | соседей по графу |
| `StepEgressGate` | whitelist + isolate | доменный алгоритм |
| runner-platform / PhaseDriver | mill внутри queue-шага | step graph |

Связь с runner-platform: [../runner-platform/README.md](../runner-platform/README.md) — step layer поверх workbook/jobKernel.

---

## Артефакты

| Что | Где |
|-----|-----|
| Schema / loader | `packages/shared/src/pipeline/pipelineManifest.*` |
| Graph | `pipelineGraph.ts` (`buildPipelineGraph`, `downstreamStepIds`, `cascadeResetOrder`) |
| Topic catalog | `packages/shared/src/transport/topicCatalog.ts` |
| Router / egress | `packages/worker/.../runtime/step/` |
| Triggers reference (generated) | [../../reference/pipeline-triggers.md](../../reference/pipeline-triggers.md) |
| Hooks & events | [../../domain/pipeline-hooks-and-events.md](../../domain/pipeline-hooks-and-events.md) |

---

## Тесты

| Файл | Что |
|------|-----|
| `pipelineManifest.contract.test.ts` | реальный манифест: связность + handlers |
| `pipelineGraph.test.ts` | edges / cascade / downstream |
| `topicCatalog.test.ts` | `buildTopicCatalog` |
| `generatePipelineTriggersDoc.test.ts` | snapshot ↔ `docs/reference/pipeline-triggers.md` |
| `stepTriggerRouter.test.ts` / `stepEgressGate.test.ts` | gates |
