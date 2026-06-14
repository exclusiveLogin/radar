# Feature: flow-коридоры (частотность P2P-отрезков)

Идея **#8** из [roadmap](../roadmap-tracking-forecasting.md).  
Фаза: **2b** ([tracking-pipeline-phases](../rfc/tracking-pipeline-phases.md)).

Связано: [ADR-013](../adr-013-trajectory-flow-and-path-fan.md), [ADR-011](../adr-011-deckgl-track-rendering.md)

---

## Цель

Показать на карте **артерии движения** — отрезки «место → место», по которым часто проходили разные треки. Толщина линии = частотность (weight/count). Слой **не заменяет** индивидуальные треки L1; это read-side аналитика поверх них.

**Принципы:** Edge aggregation, Visual frequency encoding.

---

## Условия отображения

| Условие | Поведение |
|---------|-----------|
| Слой `flow` выключен | не запрашивать `/map/tracks/flow` |
| `asOf` на timeline | rollup только facts `<= asOf` |
| `minCount` | отрезки с count < threshold скрыты |
| `threatProfile` filter | только rollup выбранного профиля |
| bbox / viewport | server-side filter + client clip |

---

## Данные

Источник: `GET /map/tracks/flow`

```typescript
type FlowFeatureProperties = {
  fromPlaceId: string;
  toPlaceId: string;
  fromPlaceName?: string;  // optional join для tooltip
  toPlaceName?: string;
  count: number;
  weight: number;
  lastSeenAt: string;
  threatProfile: string;
};
```

Geometry: `LineString` — `[from_lon, from_lat] → [to_lon, to_lat]`.

---

## Визуализация

### Deck.gl PathLayer (фаза 4)

```typescript
new PathLayer({
  id: "tracking-flow",
  data: flowFeatures,
  getPath: (d) => d.geometry.coordinates,
  getWidth: (d) => widthScale(d.properties.weight),
  widthUnits: "pixels",
  getColor: [100, 140, 200, 160],  // нейтральный коридор, под individual tracks
  pickable: true,
});
```

### widthScale (SSOT UI)

`packages/web/src/widgets/geo-map/trackFlowWidth.ts`:

```typescript
/** Логарифмическая шкала: count=1 тонко, count=50+ — cap maxWidth. */
function flowLineWidth(weight: number, minW = 1, maxW = 12): number;
```

### Tooltip

- «Балашов → Саратов: **12** проходов»
- Last seen: `lastSeenAt`
- Click → zoom + highlight связанные L1 tracks (v2)

---

## Панель слоёв

| Toggle | ID | Default |
|--------|-----|---------|
| Коридоры движения | `tracks_flow` | off (шум на первом включении) |

Фильтры в sidebar (v2): `threatProfile`, `minCount` slider.

---

## Связь с L1

| L1 | L2 flow |
|----|---------|
| Individual track path | Aggregated P2P segments |
| Kalman velocity | не используется |
| Predict ellipse | не используется |
| Kill/Pass | ортогонально; можно overlay |

---

## Критерии приёмки (UI)

- [ ] При 3+ треках через A→B одна линия толще, чем при count=2
- [ ] `asOf` назад — часть артерий исчезает
- [ ] Toggle не ломает TripsLayer individual tracks
- [ ] bbox pan/zoom — перезапрос с debounce

---

## Не делаем (v1)

- Анимация flow
- Directed arrow heads на каждом сегменте
- Heatmap вместо line width
