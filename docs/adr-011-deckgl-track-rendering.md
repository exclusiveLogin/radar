# ADR-011: Deck.gl для отрисовки треков

Дата: 2026-06-12  
Статус: **Предложено**

Связано: [ADR-007](./adr-007-trajectory-graph-kalman-worker.md), [features/tracking-temporal-color.md](./features/tracking-temporal-color.md), [features/tracking-confidence-ellipse.md](./features/tracking-confidence-ellipse.md)

---

## Контекст

MapLibre GL уже используется для operational слоёв (regions, districts, heatmap). Для отрисовки ~150k точек треков за месяц с **временным цветовым кодированием** (остывающие линии) и плавной анимацией чистый MapLibre line-gradient недостаточен по производительности и выразительности.

---

## Решение

### Архитектура рендеринга

```text
MapLibre GL (base map + operational layers)
  +
Deck.gl overlay (@deck.gl/mapbox)
  ├── PathLayer / TripsLayer  — треки, temporal color
  └── GeoJsonLayer            — эллипсы прогноза
```

### Зависимости (packages/web)

```json
{
  "@deck.gl/core": "^9.x",
  "@deck.gl/layers": "^9.x",
  "@deck.gl/mapbox": "^9.x"
}
```

Версии зафиксировать при имплементации; совместимость с `maplibre-gl ^4.7`.

### Слои Deck.gl

| Layer | Данные | Назначение |
|-------|--------|------------|
| `TripsLayer` | `GET /map/tracks` paths | Остывающие треки, GPU trail |
| `GeoJsonLayer` | `GET /map/tracks/prediction` | Эллипсы ковариации |
| (опционально) `ScatterplotLayer` | terminal kill nodes | ADR-010 highlight |

### Интеграция с geo-map

- Overlay монтируется в существующий `geoMapEngine` / lifecycle hook
- Единый `historicalAsOf$` из `MapTimelineBar` — перезапрос tracks + prediction при смене `asOf`
- Operational fold layers **не** мигрируют на Deck.gl

### Альтернативы (отвергнуты)

| Вариант | Причина отказа |
|---------|----------------|
| MapLibre line-gradient only | Слабый temporal encoding, perf на 150k |
| Canvas 2D custom | Дублирование, нет WebGL batching |
| Cesium / 3D | Overkill для 2D OSINT карты |

---

## Не делаем

- Замену heatmap operational слоя на Deck.gl HeatmapLayer (MapLibre heatmap достаточен)
- Deck.gl для region/district polygons

---

## Последствия

| Плюс | Минус |
|------|-------|
| GPU batching, TripsLayer API | +~200kb bundle |
| Единый overlay для треков и эллипсов | Два рендер-стека (MapLibre + Deck) |

---

## Критерии принятия

- Треки отображаются поверх MapLibre без z-fighting
- Temporal color работает при scrub таймлайна
- `npm run build` web проходит; typecheck зелёный
