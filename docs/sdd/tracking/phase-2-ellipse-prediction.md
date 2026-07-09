# SDD: Tracking — Фаза 2 — Ellipse + Time Machine

Статус: **ready for implementation**  
Work packages: T2.1–T2.3  
ADR: [007](../../adr-007-trajectory-graph-kalman-worker.md)  
Feature: [confidence ellipse](../../features/tracking-confidence-ellipse.md)

**Критерий входа:** фаза 1 в проде; `GET /map/tracks` стабилен.

---

## 1. Scope / Out of scope

### In scope

- Domain `covarianceEllipse.ts`, `predictKalmanState.ts`
- API `GET /map/tracks/prediction?asOf=`
- MapLibre layer `prediction-ellipse`
- Bind `historicalAsOf$` → refetch prediction
- Pause-aware Q blow-up (до 9h)

### Out of scope

- Deck.gl (фаза 4)
- Path fan (фаза 2c)
- Multi-hypothesis ellipses
- 3D cone

---

## 2. Архитектура

```text
GET /map/tracks/prediction?asOf=
  → load active tracks (last node + kalman_state)
  → for each: if asOf <= lastNode.occurredAt → skip
  → predictKalmanState(state, dt=asOf-last, Q with pause factor)
  → covarianceToEllipseRing(P_xy, confidence)
  → GeoJSON FeatureCollection
```

Read-side only — **не** пишет в БД.

---

## 3. Контракты

### 3.1 Zod — `packages/shared/src/schemas/map/tracks-prediction.ts`

```typescript
export const tracksPredictionQuerySchema = z.object({
  asOf: z.string().datetime(),
  bbox: z.string().optional(),
  confidence: z.coerce.number().min(0.5).max(0.99).default(0.95),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  status: z.enum(["active"]).default("active"),
});

export const predictionEllipsePropertiesSchema = z.object({
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
  threatProfile: threatProfileSchema,
});

export const tracksPredictionResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: z.object({
        type: z.literal("Polygon"),
        coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
      }),
      properties: predictionEllipsePropertiesSchema,
    }),
  ),
  meta: z.object({ asOf: z.string().datetime(), count: z.number().int() }),
});
```

### 3.2 API

| GET | `/map/tracks/prediction` |
|-----|--------------------------|
| **asOf** | required |
| **bbox** | optional viewport |
| **confidence** | default 0.95 |

---

## 4. Алгоритмы

### 4.1 `predictKalmanState.ts`

```typescript
export function predictKalmanState(
  state: KalmanStateJson,
  dtSeconds: number,
  profile: ProfileKinematics,
  pausePolicy: PausePolicy,
): KalmanStateJson;
```

**PausePolicy v1:**

| pauseHours | Q multiplier |
|------------|--------------|
| ≤ 1 | 1 |
| 1–3 | 2 |
| 3–9 | 5 |
| > 9 | 10 (cap expansion) |

### 4.2 `covarianceEllipse.ts`

```typescript
export function chi2Scale2D(confidence: number): number;
export function eig2x2(P: Matrix2x2, k: number): { semiMajor: number; semiMinor: number; bearingRad: number };
export function covarianceToEllipseRing(
  lat0: number,
  lon0: number,
  P: Matrix2x2,
  confidence?: number,
  segments?: number,
): Array<[lon, lat]>;
```

- Local projection: equirectangular around `(lat0, lon0)`
- Ring closed, `[lon, lat]` order for GeoJSON

### 4.3 SQL load

```sql
SELECT t.id, t.threat_profile, t.velocity_ms,
       n.occurred_at, n.lat, n.lon, n.kalman_state
FROM mat_track t
JOIN LATERAL (
  SELECT * FROM mat_track_node
  WHERE track_id = t.id AND mode = 'correct'
  ORDER BY seq DESC LIMIT 1
) n ON true
WHERE t.status = 'active';
```

Filter `n.occurred_at <= :asOf` for Time Machine consistency.

---

## 5. Web (minimal)

### 5.1 Files

- `packages/web/src/widgets/geo-map/layers/predictionEllipseLayer.ts`
- `packages/web/src/widgets/geo-map/stores/tracksPredictionStore.ts`

### 5.2 Lifecycle

```typescript
historicalAsOf$.pipe(
  switchMap(asOf => mapApi.tracksPrediction({ asOf, bbox })),
).subscribe(setPredictionGeoJson);
```

### 5.3 MapLibre

- Source: `prediction-ellipse`
- Layers: fill-opacity 0.15, line dash
- Toggle: `MapLayersPanel` → `tracks_prediction`

---

## 6. Тесты

| Test | Описание |
|------|----------|
| unit | P diagonal → circle-like ellipse |
| unit | pause 9h → semiMajor grows vs 1h |
| unit | confidence 0.95 vs 0.99 scale |
| integration | asOf before last obs → empty FC |
| integration | asOf after last obs → N features |

Golden: known P matrix → expected semi-axes ±1%.

---

## 7. DoD checklist

- [ ] `covarianceToEllipseRing` unit tests green
- [ ] API returns valid GeoJSON; empty when asOf ≤ last obs
- [ ] Timeline scrub forward shows ellipse on map
- [ ] Pause 9h fixture expands zone
- [ ] Swagger + Zod
- [ ] No Deck.gl dependency

---

## 8. Риски

| Риск | Митигация |
|------|-----------|
| Missing kalman_state on old nodes | skip track + log metric |
| Projection error far north | v2 UTM zone |
| Too many ellipses | limit + bbox |

---

## 9. Коммиты

| # | Содержание |
|---|------------|
| C1 | shared predict + ellipse + tests |
| C2 | API prediction endpoint |
| C3 | web MapLibre layer + timeline wire |
