# Feature: эллипсы доверия прогноза (Confidence Ellipse)

Идея **#4** из [roadmap](../roadmap-tracking-forecasting.md).  
Фаза: **2** ([tracking-pipeline-phases](../rfc/tracking-pipeline-phases.md)).

Связано: [ADR-007](../adr-007-trajectory-graph-kalman-worker.md), [ADR-011](../adr-011-deckgl-track-rendering.md)

---

## Цель

Перевести математическую неопределённость фильтра Калмана (матрица ковариации **P** 2×2) в GeoJSON-полигоны на карте. Для незавершённых треков (или при `asOf` в будущем относительно последнего наблюдения) пользователь видит зону, где цель с заданной вероятностью (default 95%) может находиться **прям сейчас**.

**Принципы:** Error Covariance Visualization, Confidence Ellipse Analysis.

---

## Условия отображения

| Условие | Поведение |
|---------|-----------|
| `asOf <= lastNode.occurredAt` | Эллипс скрыт (исторический replay) |
| `asOf > lastNode.occurredAt` | Predict step + эллипс |
| Стабильный полёт | Узкий луч вперёд по курсу |
| Пауза до 9h | Контролируемое расширение Q (process noise) |

---

## Алгоритм: P → GeoJSON Polygon

### Вход

- Kalman state после `predict(dt)` где `dt = asOf - lastNode.occurredAt`
- Submatrix **P** позиций `P_xy` (2×2) из полного состояния
- Confidence level `α = 0.95` → χ² scale `k = 5.991` (2 DOF)

### Шаги

1. **Eigendecomposition** `P_xy = V Λ Vᵀ`
2. Полуоси: `a = sqrt(k * λ₁)`, `b = sqrt(k * λ₂)` (в метрах, через локальную проекцию)
3. Угол поворота: `θ = atan2(V₁₁, V₂₁)`
4. Генерация N-угольника (N=64): точки эллипса в local ENU → WGS84
5. Замыкание ring → GeoJSON `Polygon`

### Локальная проекция

Для малых расстояний: equirectangular вокруг `(lat₀, lon₀)` последнего наблюдения. Для production v2 — рассмотреть proj4/utm zone.

### Псевдокод

```typescript
function covarianceToEllipseRing(
  lat0: number,
  lon0: number,
  P: [[number, number], [number, number]],
  confidence = 0.95,
  segments = 64,
): Array<[number, number]> {
  const k = chi2Scale2D(confidence);
  const { semiMajor, semiMinor, bearingRad } = eig2x2(P, k);
  return ellipseRingWgs84(lat0, lon0, semiMajor, semiMinor, bearingRad, segments);
}
```

SSOT: `packages/shared/src/domain/tracking/covarianceEllipse.ts`

---

## API

### `GET /map/tracks/prediction`

| Query | Описание |
|-------|----------|
| `asOf` | **Обязателен** — маркер Time Machine (ISO8601) |
| `bbox` | Опционально — viewport filter |
| `confidence` | Default `0.95` |
| `limit` | Max эллипсов (default 500) |

### Response (Zod)

```typescript
const predictionEllipseFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
  properties: z.object({
    trackId: z.string().uuid(),
    confidence: z.number(),
    predictedAt: z.string().datetime(),
    centerLat: z.number(),
    centerLon: z.number(),
    semiMajorM: z.number(),
    semiMinorM: z.number(),
    bearingDeg: z.number(),
    velocityMs: z.number().nullable(),
    lastObservationAt: z.string().datetime(),
    pauseHours: z.number(),
  }),
});
```

---

## UI

| Элемент | Значение |
|---------|----------|
| Layer ID | `prediction-ellipse` |
| Карта | MapLibre `fill` + `line` (фаза 2); Deck.gl `GeoJsonLayer` (фаза 4) |
| Панель слоёв | Toggle в `MapLayersPanel` (после появления tracks layer) |
| Timeline | Перезапрос при изменении `historicalAsOf$` |

Стиль: полупрозрачная заливка, пунктирный контур, цвет по `velocityMs` (опционально v2).

---

## Definition of Done

- [ ] Unit-тест: известная P → ожидаемые semi-axes и bearing
- [ ] API возвращает FeatureCollection, валидируется Zod
- [ ] Эллипс появляется при scrub таймлайна вперёд
- [ ] Пауза 9h — эллипс расширяется, не схлопывается в точку

---

## Не в scope v1

- Multi-hypothesis tracking (несколько эллипсов на трек)
- 3D uncertainty cone
