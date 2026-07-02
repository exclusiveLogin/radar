# Phase 1c — Attention Assign (JPDA-lite)

> **Superseded**: `attentionMatrix`/`assignCandidates`/offline auto-tune (`trackingFitness`, `configSampler`) удалены при hard-cut на `nextgen-gravity`. Join выполняет `NextGenPhase3` (Kalman-локус + H3-гравитация), см. `packages/shared/src/domain/tracking/nextgen/`.

## Цель

Заменить greedy `tryLink` на **attention assign** с единой весовой моделью:

- **Link:** `linkCost = D_M² / timeDecay(track)` → min
- **Seed:** `seedScore = seedMult(type) × C_geo × C_region` → max vs `SEED_MIN`

## Модули (SSOT: `packages/shared/src/domain/tracking/`)

| Модуль | Назначение |
|--------|------------|
| `eventTypeCoefficients.ts` | seedMult, kinematicMult, terminateOnAttach |
| `pointWeightModel.ts` | C_geo, C_region, computeSeedScore |
| `trackingEligibility.ts` | hard gates: geo, pipeline types |
| `mat2.ts` / `predictKalmanState.ts` / `innovationScore.ts` | локус, Mahalanobis, timeDecay |
| `attentionMatrix.ts` | track-centric matrix |
| `assignCandidates.ts` | Phase B resolve + consumed |
| `trackingFitness.ts` / `configSampler.ts` | offline auto-tune |

## Фазы A/B/C

1. **A** — predict + fill `[point][track]`, profile filter
2. **B** — in-locus → link; soft → mutation up; seed; intercept → close
3. **C** — mutation down после confirm (correct node)

## Pipeline types

`fixation | danger | warning | mass_warning | pvo_work | pvo_report | intercept`

## Worker

`trackingRebuildService` → `assignBatch()` (full + incremental).  
`loadTrackingCandidates` → `regions.front_region`, `isInteriorRf`, `NOT EXISTS` consumed.

## Auto-tune (удалено)

Offline auto-tune subsystem (`trackingTuneCli`, `TrackingTuneWidget`, API `/admin/tracking/tune/*`) удалён вместе с GNN hard-cut — был тесно связан с GNN attention/greedy-flow алгоритмами. Таблица `tracking_tune_runs` осталась в БД как история миграций, но не используется.

## Supersedes

Link phase из [phase-1-l1-mvp.md](./phase-1-l1-mvp.md) заменён attention assign.
