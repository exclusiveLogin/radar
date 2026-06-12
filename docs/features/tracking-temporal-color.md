# Feature: временное цветовое кодирование треков (остывающие линии)

Идея **#6** из [roadmap](../roadmap-tracking-forecasting.md).  
Фаза: **4** ([tracking-pipeline-phases](../rfc/tracking-pipeline-phases.md)).

Связано: [ADR-011](../adr-011-deckgl-track-rendering.md), [ADR-006](../adr-006-map-read-line-fold.md)

---

## Цель

Динамически менять цвет и прозрачность линий треков по «возрасту» точки относительно курсора Time Machine. Свежие сегменты — тёплый красный; старые — холодный синий с fade-out. Пользователь видит эволюцию тактики, а не «кашу» из 150k линий за месяц.

**Принципы:** Temporal Color Coding, Dynamic Trend Visualization.

---

## Формула цвета

```text
ageMs = asOf - node.occurredAt
```

| ageMs | Цвет (RGB) | Opacity |
|-------|------------|---------|
| 0 | `#FF3B30` (warm red) | 1.0 |
| 1h | `#FF9500` | 0.85 |
| 6h | `#5AC8FA` | 0.6 |
| 24h+ | `#007AFF` (cold blue) | 0.2 → 0 |

Интерполяция: HSL или piecewise linear в `packages/web/src/widgets/geo-map/trackColor.ts`.

```typescript
function trackPointColor(ageMs: number, maxAgeMs: number): [number, number, number, number] {
  const t = Math.min(1, ageMs / maxAgeMs);
  return hslaLerp(WARM_RED, COLD_BLUE, t);
}
```

`maxAgeMs` default = 24h (configurable в UI).

---

## Deck.gl TripsLayer

### Данные

Трансформация `GET /map/tracks` → TripsLayer format:

```typescript
type TripPath = {
  path: Array<[lon, lat, timestamp]>; // timestamp = occurredAt ms
  trackId: string;
};
```

### Layer props

```typescript
new TripsLayer({
  id: "tracking-trips",
  data: trips,
  getPath: (d) => d.path,
  getTimestamps: (d) => d.path.map((p) => p[2]),
  currentTime: asOf.getTime(),
  trailLength: TRAIL_LENGTH_MS, // e.g. 24 * 3600 * 1000
  getColor: (d) => trackPointColor(asOf - d.timestamp, maxAgeMs),
  widthMinPixels: 2,
  opacity: 0.85,
});
```

`currentTime` = `historicalAsOf$.value.getTime()` — синхронизация с `MapTimelineBar`.

---

## UI

| Элемент | Поведение |
|---------|-----------|
| `MapTimelineBar` | Единый SSOT `historicalAsOf$` для fold + tracks |
| Layer toggle | `tracks` в `MapLayersPanel` |
| Legend | Компактная шкала warm→cold (опционально v1.1) |

При `asOf = now` — только «горячие» последние сегменты видны ярко.

---

## Производительность

- Лимит треков на viewport: `limit` query + bbox filter
- TripsLayer WebGL instancing — target 150k points @ 30fps
- Debounce перезапроса при scrub таймлайна (150ms)

---

## Definition of Done

- [ ] TripsLayer overlay на MapLibre без артефактов
- [ ] Цвет меняется при движении ползунка
- [ ] Старые треки fade out, не перекрывают свежие
- [ ] `npm run build` web проходит

---

## Не в scope v1

- Анимация play/pause по времени (auto-timeline)
- Per-track цвет по типу цели (drone vs rocket)
