# SDD: Tracking — Фаза 4 — Deck.gl UX (unified overlay)

Статус: **ready for implementation**  
Work packages: T4.1–T4.3  
ADR: [011](../../adr-011-deckgl-track-rendering.md)  
Features: [temporal color](../../features/tracking-temporal-color.md), [flow](../../features/tracking-flow-corridors.md), [path fan](../../features/tracking-historical-path-fan.md), [ellipse](../../features/tracking-confidence-ellipse.md)

**Критерий входа:** API фаз 1–3 + 2b/2c стабильны; MapLibre v0 layers работают.

---

## 1. Scope / Out of scope

### In scope

- `@deck.gl/mapbox` overlay в geo-map
- TripsLayer — L1 tracks, temporal color
- PathLayer — flow corridors (width)
- PathLayer — path fan (dashed)
- GeoJsonLayer — prediction ellipses
- ScatterplotLayer — kill nodes (optional)
- Unified `historicalAsOf$` data fetching
- Layer toggles in `MapLayersPanel`
- bbox debounced refetch

### Out of scope

- Migrate operational fold to Deck.gl
- Replace MapLibre event heatmap
- 3D / Cesium

---

## 2. Архитектура

```text
MapLibre (base + operational)
  └── DeckOverlay (@deck.gl/mapbox)
        ├── PathLayer      id=tracking-flow      (z-bottom)
        ├── PathLayer      id=tracking-path-fan
        ├── TripsLayer     id=tracking-trips
        ├── GeoJsonLayer   id=tracking-prediction
        └── ScatterplotLayer id=tracking-kill   (optional)

tracksStore / flowStore / fanStore / predictionStore
  ← historicalAsOf$ + bbox$ + layerToggles$
```

---

## 3. Зависимости

`packages/web/package.json`:

```json
{
  "@deck.gl/core": "^9.0.0",
  "@deck.gl/layers": "^9.0.0",
  "@deck.gl/mapbox": "^9.0.0"
}
```

Verify peer compatibility with `maplibre-gl ^4.7`.

---

## 4. Data fetching SSOT

### 4.1 `useTrackingMapData.ts`

```typescript
export function useTrackingMapData(deps: {
  asOf$: Observable<string>;
  bbox$: Observable<Bbox>;
  toggles$: Observable<TrackingLayerToggles>;
}): DeckLayers[];
```

Parallel fetch when toggles on:

| Toggle | Endpoint |
|--------|----------|
| tracks | `GET /map/tracks?asOf&bbox&limit` |
| flow | `GET /map/tracks/flow?asOf&bbox` |
| pathFan | `GET /map/tracks/:selectedId/path-fan?asOf` |
| prediction | `GET /map/tracks/prediction?asOf&bbox` |
| kill | `GET /map/tracks/layers?layer=kill&asOf&bbox` |

Debounce bbox: **300ms**.

### 4.2 TripsLayer transform

`packages/web/src/widgets/geo-map/trackTripsTransform.ts`:

```typescript
/** Map TrajectoryTrack[] → TripsLayer data { path, timestamps, trackId } */
export function tracksToTripsData(
  tracks: TrajectoryTrack[],
  asOf: string,
): TripsDatum[];
```

---

## 5. Layer specs

### 5.1 TripsLayer — temporal color

File: `trackColor.ts` (from feature-006)

```typescript
getPath: (d) => d.path,
getTimestamps: (d) => d.timestamps,
getColor: (d) => trackPointColor(asOf, d.timestamp, maxAgeMs),
trailLength: 3600, // seconds visible trail
```

### 5.2 PathLayer — flow

File: `trackFlowWidth.ts`

```typescript
getWidth: (d) => flowLineWidth(d.properties.weight),
getColor: [100, 140, 200, 160],
widthUnits: "pixels",
```

### 5.3 PathLayer — path fan

File: `trackFanStyle.ts`

```typescript
getDashArray: [4, 2],
getWidth: (d) => fanLineWidth(d.count, maxCount),
getColor: (d) => fanPathColor(d.rank, maxRank),
```

### 5.4 GeoJsonLayer — prediction

Replace MapLibre ellipse layer when Deck enabled (feature flag `deckTrackingOverlay`).

### 5.5 Z-order (bottom → top)

1. flow  
2. path fan  
3. trips (tracks)  
4. prediction ellipse  
5. kill scatter  

---

## 6. Integration points

### 6.1 `geoMapEngine.ts`

```typescript
import { MapboxOverlay } from "@deck.gl/mapbox";

let deckOverlay: MapboxOverlay | null = null;

export function mountDeckOverlay(map: MaplibreMap, layers: Layer[]) {
  deckOverlay?.setProps({ layers });
}
```

Lifecycle: mount on map load, unmount on destroy, sync viewState.

### 6.2 `MapLayersPanel`

| Toggle key | Label |
|------------|-------|
| `tracks_trips` | Треки движения |
| `tracks_flow` | Коридоры (частотность) |
| `tracks_path_fan` | Вероятностные пути |
| `tracks_prediction` | Зона прогноза |
| `tracks_kill` | Сбития (ПВО) |

Defaults: trips off, flow off, fan on when track selected.

### 6.3 Track selection

- Click TripsLayer pick → `selectedTrackId$`
- Path fan auto-fetch for selected active track

---

## 7. Performance

| Concern | Mitigation |
|---------|------------|
| 150k points/month | `limit` + bbox; TripsLayer GPU |
| Refetch storm | debounce; stale request cancel (AbortSignal) |
| Bundle +200kb | lazy import deck overlay route-level |
| Memory | drop hidden layer data from stores |

Target: 60fps pan/zoom on mid GPU with limit=500 tracks in viewport.

---

## 8. Feature flag

```typescript
// packages/web/src/config/features.ts
export const DECK_TRACKING_OVERLAY = import.meta.env.VITE_DECK_TRACKING === "1";
```

Fallback: MapLibre layers from phases 2/2b/2c/3.

---

## 9. Тесты

| Type | Scope |
|------|-------|
| unit | trackTripsTransform, trackColor, flowLineWidth |
| component | useTrackingMapData toggles don't fetch when off |
| manual | scrub timeline, 150k dataset smoke |
| build | `npm run build` web passes |

---

## 10. DoD checklist

- [ ] Deck overlay mounts without z-fighting
- [ ] Temporal color on timeline scrub
- [ ] Flow width visible when enabled
- [ ] Fan + ellipse simultaneous, distinct styles
- [ ] Kill scatter optional toggle
- [ ] Fallback to MapLibre when flag off
- [ ] typecheck + build green
- [ ] Layer toggles persist in sessionStorage (optional v2)

---

## 11. Риски

| Рisk | Mitigation |
|------|------------|
| maplibre/deck version skew | pin versions in lockfile |
| Picking performance | pickable only on trips + kill |
| Mobile WebGL | reduce limit on narrow viewport |

---

## 12. Коммиты

| # | Содержание |
|---|------------|
| C1 | deck overlay infra + TripsLayer + temporal color |
| C2 | flow + fan PathLayers |
| C3 | GeoJsonLayer ellipse + kill scatter + panel toggles |
