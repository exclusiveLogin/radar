# ADR-019: Tracking ML Engine (design only)

**Статус:** proposed (design)  
**Дата:** 2026-07-09  
**Реализация:** не начата — только архитектурный контур

Связано: [ADR-007](../adr-007-trajectory-graph-kalman-worker.md) · [roadmap-tracking-forecasting.md](../roadmap-tracking-forecasting.md) · [ADR-013](../adr-013-trajectory-flow-and-path-fan.md)

---

## Контекст

Текущий tracking pipeline (T1) — **детерминированная** цепочка: pre-collapse → kinematic filter → spatio-temporal link → Kalman. Это покрывает MVP (треки, velocity, heatmap filter).

Post-MVP задачи (flow corridors, path fan, kill/pass scoring) требуют:
- обучаемых весов на исторических траекториях;
- ранжирования гипотез link/fork без жёстких порогов;
- anomaly detection (outlier OSINT points).

**ML Engine** — отдельный bounded context, который **не заменяет** Kalman core, а дополняет его inference-слоем.

---

## Решение (design)

### Слои

```text
┌─────────────────────────────────────────┐
│ Tracking ML Engine (inference only)     │
│  — link scorer, fork predictor, anomaly │
│  — batch/offline train, online score    │
└──────────────┬──────────────────────────┘
               │ scores / weights
┌──────────────▼──────────────────────────┐
│ Tracking domain (packages/shared)       │
│  — linkNodes, kalmanStep, buildTrack    │
│  — pure functions, testable             │
└──────────────┬──────────────────────────┘
               │ mat_track / mat_track_node
┌──────────────▼──────────────────────────┐
│ Worker orchestrator (runner platform)   │
└─────────────────────────────────────────┘
```

### Принципы

1. **Kalman остаётся SSOT кинематики** — ML не пишет в `kalman_state` напрямую.
2. **Inference отделён от training** — train offline (Python/notebook или batch job), deploy weights as artifact.
3. **Feature store = mat_parse_location + mat_track_node** — без новой message-copy очереди.
4. **Fallback** — если ML unavailable, pipeline работает на rule-based порогах (ADR-007/009).

---

## Компоненты (planned)

| Комponent | Input | Output | Runtime |
|-----------|-------|--------|---------|
| **LinkScorer** | candidate pair (node A, node B), features | score 0..1 | worker batch tick |
| **ForkPredictor** | track tail + historical flow graph | fork probabilities | on-demand / batch |
| **AnomalyDetector** | single observation + local context | anomaly flag | inline в link step |
| **FlowPrior** | P2P rollup (ADR-013) | corridor weight | periodic refresh |

### Feature vector (v1 sketch)

```typescript
type LinkFeatureVector = {
  spatialDistM: number;
  temporalDeltaSec: number;
  velocityConsistency: number;
  threatProfileMatch: number;
  sourceChannelCount: number;
  placeTrustMin: number;
};
```

---

## Хранение (planned)

| Artifact | Формат | Где |
|----------|--------|-----|
| Model weights | JSON / ONNX | `data/ml/tracking/` (gitignored prod weights) |
| Training snapshot | Parquet export CLI | `npm run radar -- tracking ml:export` |
| Inference log | `mat_track_ml_score` (optional table) | Postgres |

---

## API (read-side, future)

| Endpoint | Назначение |
|----------|------------|
| `GET /map/tracks/:id/scores` | ML confidence per link |
| `GET /map/tracks/layers/ml-anomaly` | Anomaly overlay |

Не в MVP — только после T2+ phases.

---

## Границы (не делаем)

- Realtime neural net на write-line parse
- End-to-end deep learning без Kalman baseline
- ML-driven изменение operational fold (ADR-006)
- Auto-deploy моделей без human review gate

---

## Зависимости

| Зависимость | Статус |
|-------------|--------|
| T1 tracking MVP (Kalman worker) | код частично, runner platform |
| Flow rollup (ADR-013 phase 2b) | design |
| Historical path fan (2c) | design |
| Golden trajectory fixtures | backlog |

---

## Следующий шаг (когда будет согласование)

1. Golden fixtures: 10–20 траекторий с ручной разметкой link/no-link.
2. Rule baseline metrics (precision/recall link).
3. Minimal LinkScorer v0 (logistic regression, offline train).
4. SDD: `docs/sdd/tracking/phase-ml-link-scorer.md`.

**До согласования с пользователем — не реализовывать.**
