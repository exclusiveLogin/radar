# Phase 5 — Data Association (ADR-015)

> **Superseded**: селектор алгоритма (gnn/pdaf/jpdaf) и offline auto-tune удалены — единственный алгоритм `nextgen-gravity`, см. `packages/shared/src/domain/tracking/nextgen/`.

База: [ADR-015](../../adr-015-data-association-reuse-and-locus.md) · supersede частично [phase-1c](./phase-1c-attention-assign.md) (gate + consume).

## Цель

- Матрица self-attention: `reuseAcrossTracks` (fan-out точки в N треков).
- Детерминированный локус `ρ = dist / r_доп(dt)` вместо ковариационного gate + pauseFactor.
- Направленный множитель тока/противотока (`ρ'`).
- Селектор алгоритма (`gnn` default; pdaf/jpdaf — backlog).
- `locusDebug` оверлей на карте (клиент, вариант A).

## Подфазы

| ID | Модуль | Файлы |
|----|--------|-------|
| P1 | `reuseAcrossTracks` | `assignCandidates.ts`, `trackingRebuildService.ts`, schema, admin UI |
| P2 | `maneuverLocus.ts` — `r_доп`, `ρ` | `attentionMatrix.ts`, `innovationScore.ts` |
| P3 | `flowAlignment.ts` — `ρ'` | `attentionMatrix.ts`, `loadTrackingCandidates.ts` (rear-bearing) |
| P4 | `associationAlgorithm` dispatch | `assignCandidates.ts`, schema, admin UI |
| P5 | `locusDebug` layer | `mapLayerStore.ts`, map overlay |

## Формулы (SSOT)

```text
r_доп(dt) = v_max · dt + σ_pos
ρ         = dist(z, ẑ) / r_доп(dt)
inLocus   ⟺ ρ ≤ 1

ρ' = ρ · (1 + γ_против·max(0,−a)) / (1 + γ_ток·max(0,+a))
a  = cos∠(шаг, f);  f = blend(f_A, f_B, w_emp)
```

## Конфиг (`trackingPipelineConfigSchema`)

- `reuseAcrossTracks`, `associationAlgorithm`
- `flowWeight`, `counterFlowPenalty`, `flowEmpiricalBlend`
- seed-поля (уже есть)

## Критерии

- Defaults => побитово phase-1c.
- `reuse=on` + 2 in-locus трека => 2 link.
- `locusDebug` рисует окружность `r_доп` на карте.
