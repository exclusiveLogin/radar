# SDD: Tracking — Фаза 3 — Kill / Pass / PVO heatmap

Статус: **ready for implementation**  
Work packages: T3.1–T3.3  
ADR: [010](../../adr-010-pvo-kill-pass-layers.md)

**Критерий входа:** фаза 1; facts `pvo_report` / air_defense в `mat_parse_event`.

---

## 1. Scope / Out of scope

### In scope

- Domain `classifyTrackSegments.ts`, `pvoZoneBuffer.ts`
- Materialized `trajectory_track_segments` (layer classification) optional v1 on-read
- API `GET /map/tracks/layers?layer=kill|pass|pvo_heatmap`
- Embed `segments[]` in `GET /map/tracks/:id`
- MapLibre layers + toggles

### Out of scope

- 3D PVO zones
- Target type classification
- Deck.gl scatter (фаза 4 optional)

---

## 2. Архитектура

```text
Facts: pvo_report mat_parse_location
  → pvoZoneBuffer(points, radiusM) → zone polygons (cached)

Tracks: mat_track_node
  → classifyTrackSegments(track, zones) → kill | pass | body

API layers endpoint → GeoJSON per layer
```

Batch: run after `tracking:rebuild` (`tracking:classify-pvo-segments`).

---

## 3. Контракты

### 3.1 Domain types

```typescript
export type TrackLayer = "body" | "kill" | "pass";

export type ClassifiedSegment = {
  trackId: string;
  layer: TrackLayer;
  fromSeq: number;
  toSeq: number;
  coordinates: Array<[lon, lat]>;
  velocityMs: number | null;
  lastAt: string;
};

export type PvoZone = {
  id: string;
  centerLat: number;
  centerLon: number;
  radiusM: number;
  /** GeoJSON polygon ring approximating circle */
  ring: Array<[lon, lat]>;
};
```

### 3.2 Zod — extend `tracks.ts`

```typescript
export const trackSegmentSchema = z.object({
  layer: z.enum(["body", "kill", "pass"]),
  fromSeq: z.number().int(),
  toSeq: z.number().int(),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

// trajectoryTrackSchema.segments optional array
```

### 3.3 Zod — `packages/shared/src/schemas/map/tracks-layers.ts`

```typescript
export const tracksLayersQuerySchema = z.object({
  layer: z.enum(["kill", "pass", "pvo_heatmap", "body"]),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  asOf: z.string().datetime().optional(),
  bbox: z.string().optional(),
  limit: z.coerce.number().int().default(1000),
});
```

### 3.4 API

| GET | `/map/tracks/layers?layer=` |
|-----|------------------------------|
| kill | Point/LineString terminal segments in zone |
| pass | LineString segments exiting zone |
| pvo_heatmap | reuse heatmap pattern, filter pvo types |

---

## 4. Алгоритмы

### 4.1 `pvoZoneBuffer.ts`

```typescript
export function buildPvoZones(
  reports: Array<{ lat: number; lon: number; occurredAt: string; id: string }>,
  config: { radiusM: number; mergeWithinM?: number },
): PvoZone[];
```

Default `TRACKING_PVO_ZONE_RADIUS_M` = 15_000 (tunable).

v1: circle approx 32-segment polygon; point-in-polygon test.

### 4.2 `classifyTrackSegments.ts`

**Kill (v1):**

- Track `status === closed`
- Last node with `mode === correct` inside any PVO zone
- No kinematic node after exit within `KILL_CONFIRM_WINDOW` (30 min default)
- Emit segment layer `kill` on terminal node (Point or degenerate Line)

**Pass (v1):**

- Edge `(node_i → node_{i+1})` where `node_i` inside zone, `node_{i+1}` outside
- Track has ≥ 2 nodes after `node_{i+1}`
- Segment layer `pass`

**Body:** all other edges (optional materialize or default implicit).

```typescript
export function classifyTrackSegments(
  track: { id: string; status: TrackStatus; nodes: TrajectoryNode[] },
  zones: PvoZone[],
  config: { killConfirmWindowMs: number },
): ClassifiedSegment[];
```

---

## 5. Миграции (optional materialize)

```sql
CREATE TABLE trajectory_track_segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id     uuid NOT NULL REFERENCES mat_track(id) ON DELETE CASCADE,
  layer        text NOT NULL CHECK (layer IN ('body','kill','pass')),
  from_seq     int NOT NULL,
  to_seq       int NOT NULL,
  coordinates  jsonb NOT NULL,
  velocity_ms  double precision,
  last_at      timestamptz,
  rebuild_gen  bigint NOT NULL DEFAULT 0
);

CREATE INDEX idx_tts_layer ON trajectory_track_segments (layer);
CREATE INDEX idx_tts_track ON trajectory_track_segments (track_id);
```

v1 alternative: compute on-read with 5min cache — document if chosen.

---

## 6. Worker

`trackingClassifyPvoService.ts`:

1. Load PVO facts since/until
2. Build zones
3. For each track: classify → persist segments table
4. Report: kill count, pass count

CLI: `tracking:classify-pvo`

Env:

| Key | Default |
|-----|---------|
| `TRACKING_PVO_ZONE_RADIUS_M` | 15000 |
| `TRACKING_KILL_CONFIRM_WINDOW_MS` | 1800000 |

---

## 7. Web

### 7.1 Layers

| Layer ID | Style |
|----------|-------|
| `tracks_kill` | red circles, radius 8px |
| `tracks_pass` | orange dashed lines |
| `pvo_heatmap` | existing heatmap component + filter |

### 7.2 Files

- `killPassLayers.ts`
- `MapLayersPanel` toggles

---

## 8. Тесты

| ID | Test |
|----|------|
| GF-09 | track exits zone → pass segment |
| GF-10 | track ends in zone → kill |
| unit | point in zone |
| unit | pass requires 2 nodes after exit |
| integration | layers API GeoJSON |

---

## 9. DoD checklist

- [ ] classifyTrackSegments unit tests
- [ ] API three layers (or kill/pass + pvo_heatmap delegate)
- [ ] `GET /map/tracks/:id` includes segments
- [ ] MapLibre toggles work
- [ ] GF-09, GF-10 pass
- [ ] No duplicate pvo facts write-path

---

## 10. Риски

| Риск | Mitigation |
|------|------------|
| False kill (coarse geo) | tune radius; show confidence in props v2 |
| Missing pvo reports | document coverage |
| Zone overlap | union zones v2 |

---

## 11. Коммиты

| # | Содержание |
|---|------------|
| C1 | domain pvo zones + classify + tests |
| C2 | worker + optional migration |
| C3 | API layers + web MapLibre |
