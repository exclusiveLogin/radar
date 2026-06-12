# Tracking pipeline: фазы реализации (ToBe)

См. [roadmap-tracking-forecasting.md](../roadmap-tracking-forecasting.md).

---

## Фаза 0 — Документация и контракты (DONE)

**Цель:** зафиксировать архитектуру до первого коммита с кодом.

- ADR-007..011 со статусом **Предложено**
- Feature docs: эллипсы, temporal color, heatmap filter
- Zod-скелеты контрактов описаны в ADR-007 (реализация — фаза 1)

**Не делаем:** миграции БД, worker, UI треков.

---

## Фаза 1 — MVP пайплайн

**Цель:** из хаотичных `event_locations` получить материализованные треки и фильтруемую теплокарту.

**Порядок внутри фазы строгий:**

1. [ADR-009](../adr-009-osint-pre-collapse.md) — OSINT pre-collapse (10-min window, hierarchy `accuracyLevel`)
2. [ADR-008](../adr-008-kinematic-vs-static-events.md) — kinematic vs static routing
3. [ADR-007](../adr-007-trajectory-graph-kalman-worker.md) — background worker: link → Kalman → persist
4. [Feature-007](../features/tracking-heatmap-filter.md) — `?eventType=` / `?eventCategory=` на heatmap

| Задача | Пакет |
|--------|-------|
| Pure functions collapse/link/kalman | `packages/shared/src/domain/tracking/` |
| Worker job + checkpoint | `packages/worker` |
| Миграции `trajectory_*` | `packages/api` (TypeORM) |
| `GET /map/tracks`, `GET /map/tracks/:id` | `packages/api/src/map/` |
| Heatmap filter query params | `MapQueryService` + `event-heatmap.ts` |

**Definition of Done:**

- Worker материализует треки в БД из исторических facts
- API отдаёт GeoJSON/JSON треков с nodes и velocity
- Heatmap фильтруется по `event_type` / `eventCategory`
- `npm run typecheck` и `npm run lint` зелёные
- **Без** UI слоя треков и Deck.gl

**Коммит:** отдельный, только tracking MVP backend + heatmap filter.

---

## Фаза 2 — Прогноз и Time Machine

**Критерий входа:** фаза 1 в проде, треки стабильны на тестовом датасете.

- [Feature-004](../features/tracking-confidence-ellipse.md) — eig(P) → GeoJSON Polygon
- `GET /map/tracks/prediction?asOf=` — эллипсы для активных треков
- Интеграция с `MapTimelineBar`: при `asOf > lastNode.occurredAt` — predict step + ellipse
- MapLibre слой `prediction-ellipse` (без Deck.gl)

**Definition of Done:**

- Эллипс на карте при движении ползунка вперёд во времени
- Пауза до 9h — контролируемое расширение зоны ожидания
- Unit-тесты на eig(P) → polygon ring

**Не делаем:** Kill/Pass, TripsLayer.

---

## Фаза 3 — ПВО-аналитика Kill/Pass

**Критерий входа:** треки + зоны ПВО (`pvo_report`, heatmap ПВО) доступны.

- [ADR-010](../adr-010-pvo-kill-pass-layers.md) — классификация сегментов
- `GET /map/tracks/layers?layer=kill|pass|pvo_heatmap`
- Три визуальных слоя на MapLibre

**Definition of Done:**

- Автоматическая подсветка terminal nodes в зоне ПВО (kill)
- Подсветка сегментов, прошедших зону насквозь (pass)
- Тепловая карта активности ПВО как отдельный layer

**Коммит:** отдельный от фазы 2.

---

## Фаза 4 — Визуализация треков (Deck.gl)

**Критерий входа:** API треков и prediction стабильны.

- [ADR-011](../adr-011-deckgl-track-rendering.md) — `@deck.gl/mapbox`, TripsLayer, GeoJsonLayer
- [Feature-006](../features/tracking-temporal-color.md) — warm→cold по `asOf - node.t`
- Overlay поверх существующего MapLibre geo-map

**Definition of Done:**

- Остывающие линии треков на GPU
- Scannability при ~150k точек за месяц
- Единый `historicalAsOf$` для timeline, треков и цвета

**Не делаем:** замена operational fold layers на Deck.gl.

---

## Вне фаз (параллельно)

- Auth на новые map endpoints (если потребуется)
- PostGIS для spatial index на `trajectory_nodes` (оптимизация, не блокер MVP)
- Realtime Kalman на write-line parse — **явно out of scope** (см. ADR-007)

Каждая — свой коммит, не смешивать с фазами tracking pipeline.
