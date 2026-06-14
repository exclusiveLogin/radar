# Tracking — SDD (Software Design Documents)

Статус: **ready for implementation** (2026-06-14)  
База: [plan.md](./plan.md) · Индекс SDD: [../README.md](../README.md)

---

## Индекс фаз

| Фаза | SDD | Критерий входа | Коммиты (ориентир) |
|------|-----|----------------|---------------------|
| **1** | [phase-1-l1-mvp.md](./phase-1-l1-mvp.md) | facts в БД | 3–4 |
| **2** | [phase-2-ellipse-prediction.md](./phase-2-ellipse-prediction.md) | фаза 1 stable | 2 |
| **2b** | [phase-2b-flow-corridors.md](./phase-2b-flow-corridors.md) | фаза 1 + place_id | 2–3 |
| **2c** | [phase-2c-path-fan.md](./phase-2c-path-fan.md) | фаза 2b или 1+index | 2 |
| **3** | [phase-3-kill-pass.md](./phase-3-kill-pass.md) | фаза 1 + pvo facts | 2–3 |
| **4** | [phase-4-deckgl-ux.md](./phase-4-deckgl-ux.md) | API 2/2b/2c/3 stable | 2–3 |

Фаза **0** (документация) — выполнена, отдельного SDD нет.

---

## Зафиксированные решения (D1–D8)

Используются во всех SDD как defaults до пересмотра:

| ID | Решение |
|----|---------|
| D1 | DISTINCT radius = `f(precision)` |
| D2 | DISTINCT window = **10 min** |
| D3 | Link gates = **per threat profile** |
| D4 | Track `closed` = **2h** без kinematic node |
| D5 | Flow `minCount` = **2** |
| D6 | Path fan suffix = **n=5 nodes** |
| D7 | Flow rollup = **materialized** table |
| D8 | L2b блокер: place_id coverage **≥ 60%** kinematic nodes (метрика в worker report) |

---

## Golden fixtures (сквозные)

`packages/shared/src/domain/tracking/__fixtures__/`

| ID | Фаза |
|----|------|
| GF-01 … GF-05 | 1 |
| GF-06, GF-08 | 2b |
| GF-07, GF-08 | 2c |
| GF-09, GF-10 | 3 |

Описание сценариев: [plan.md §5](./plan.md#5-golden-fixtures-ssot-тест-данные).

---

## Порядок реализации (рекомендуемый)

```text
1 → 2b → 3 → 2 → 2c → 4
```

Параллель после **1:** `2`, `2b`, `3` — независимые коммиты.

---

## ADR / Feature map

| SDD | ADR | Features |
|-----|-----|----------|
| 1 | 007, 008, 009† | heatmap filter |
| 2 | 007 | confidence ellipse |
| 2b–2c | 013 | flow, path fan |
| 3 | 010 | — |
| 4 | 011 | temporal color |

† ADR-009 partial supersede → DISTINCT + R + gating
