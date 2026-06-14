# Feature: historical path fan (вероятностные хвосты)

Идея **#9** из [roadmap](../roadmap-tracking-forecasting.md).  
Фаза: **2c** ([tracking-pipeline-phases](../rfc/tracking-pipeline-phases.md)).

Связано: [ADR-013](../adr-013-trajectory-flow-and-path-fan.md), [tracking-confidence-ellipse.md](./tracking-confidence-ellipse.md), [ADR-011](../adr-011-deckgl-track-rendering.md)

---

## Цель

Для **active track** в prediction-режиме показать, **куда historically уходили** цели из текущей последней точки (anchor place). Несколько веток с толщиной ∝ частотности — «вероятностные пути» без multi-hypothesis Kalman.

**Не путать** с эллипсом Kalman: ellipse = физическая зона неопределённости; path fan = behavioral prior из истории.

---

## Когда показывать

| Условие | Поведение |
|---------|-----------|
| Track `status !== active` | fan скрыт |
| `asOf <= lastNode.occurredAt` | fan скрыт (historical replay) |
| `asOf > lastNode.occurredAt` | запрос path-fan + ellipse параллельно |
| last node без `place_id` | fallback: snap nearest place v2; v1 — fan скрыт + tooltip |
| `paths.length === 0` | только ellipse, без fan |

---

## Данные

`GET /map/tracks/:id/path-fan?asOf=&n=5&topK=10`

```typescript
type PathFanPath = {
  placeSequence: string[];       // [anchor, ...n places]
  count: number;
  weight: number;
  coordinates: Array<[lon, lat]>;
};

type HistoricalPathFanResponse = {
  anchorPlaceId: string;
  anchorCoordinates: [lon, lat];
  asOf: string;
  suffixLength: number;
  paths: PathFanPath[];
};
```

---

## Визуализация

### Композиция на карте

```text
[flow corridors — фон, optional]
[path fan — ветки от last node, dashed/warm palette]
[individual track — solid, temporal color]
[kalman ellipse — polygon, cool transparent]
```

### Deck.gl PathLayer

```typescript
new PathLayer({
  id: "tracking-path-fan",
  data: fan.paths,
  getPath: (d) => d.coordinates,
  getWidth: (d) => fanLineWidth(d.count, maxCount),
  getColor: (d) => fanPathColor(d.count, maxCount),  // warm gradient by rank
  getDashArray: [4, 2],
  dashJustified: true,
  pickable: true,
});
```

### Tooltip

- «После **Таганрог**: 12× → Ростов → …»
- Rank #1, #2, … по count

---

## UX-сценарий

1. Пользователь выбирает active track на карте или из списка.
2. Двигает timeline вперёд (`asOf > last observation`).
3. Видит:
   - **ellipse** — где цель может быть kinematically;
   - **fan** — куда historically летали из этой точки;
   - dominant branch — самая толстая линия.

---

## Параметры (query / settings)

| Param | Default | Описание |
|-------|---------|----------|
| `n` | 5 | длина suffix в nodes |
| `topK` | 10 | max веток |
| `minCount` | 2 | скрыть редкие пути |
| `threatProfile` | inherit from track | фильтр истории |

---

## Панель / controls

- Toggle «Вероятностные пути» (`tracks_path_fan`) — default on при selected active track
- Slider `n` (3–8) — advanced panel v2

---

## Критерии приёмки (UI)

- [ ] Active track + future `asOf` → fan + ellipse одновременно
- [ ] Historical replay → только track body, без fan
- [ ] Две ветки с разным count — разная толщина
- [ ] `asOf` назад уменьшает counts на ветках
- [ ] Legend различает ellipse vs fan

---

## Не делаем (v1)

- Interactive «выбрать ветку» → constrain Kalman (MHT)
- Percent labels на линиях (только tooltip)
- 3D cone visualization
