# SDD: Tracking — Фаза 2b — Flow corridors (P2P rollup)

Статус: **ready for implementation**  
Work packages: T2b.1–T2b.5  
ADR: [013](../../adr-013-trajectory-flow-and-path-fan.md)  
Feature: [flow corridors](../../features/tracking-flow-corridors.md)

**Критерий входа:** фаза 1; `placeIdCoveragePct ≥ 60%` на kinematic nodes.

---

## 1. Scope / Out of scope

### In scope

- Domain `flow/buildTrackEdges`, `flow/rollupSegmentCounts`
- Tables `trajectory_edges`, `trajectory_segment_rollup`
- Worker jobs после rebuild
- API `GET /map/tracks/flow`
- MapLibre v0 line-width (optional)

### Out of scope

- Path fan (2c)
- H3 spatial snap (v2)
- Deck.gl width (фаза 4)
- Whole-track intersect

---

## 2. Архитектура

```text
tracking:rebuild (L1)
  → tracking:materialize-edges
  → tracking:rollup-flow

GET /map/tracks/flow?asOf=
  → read trajectory_segment_rollup (+ filter occurred_at via edge refresh)
  → GeoJSON LineString features
```

L2 — **read projection**, не меняет L1 Kalman.

---

## 3. Контракты

### 3.1 Domain types

```typescript
export type TrajectoryEdge = {
  trackId: string;
  fromNodeId: string;
  toNodeId: string;
  fromPlaceId: string;
  toPlaceId: string;
  fromSeq: number;
  toSeq: number;
  threatProfile: ThreatProfile;
  occurredAt: string; // to_node.occurred_at
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
};

export type SegmentRollup = {
  fromPlaceId: string;
  toPlaceId: string;
  threatProfile: ThreatProfile;
  count: number;
  weight: number;
  lastSeenAt: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
};
```

### 3.2 Zod — `packages/shared/src/schemas/map/tracks-flow.ts`

```typescript
export const tracksFlowQuerySchema = z.object({
  asOf: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  bbox: z.string().optional(),
  threatProfile: threatProfileSchema.optional(),
  minCount: z.coerce.number().int().min(1).default(2),
  limit: z.coerce.number().int().max(10_000).default(2000),
});

export const flowFeaturePropertiesSchema = z.object({
  fromPlaceId: z.string().uuid(),
  toPlaceId: z.string().uuid(),
  fromPlaceName: z.string().optional(),
  toPlaceName: z.string().optional(),
  count: z.number().int(),
  weight: z.number(),
  lastSeenAt: z.string().datetime(),
  threatProfile: threatProfileSchema,
});
```

### 3.3 API

| GET | `/map/tracks/flow` |
|-----|---------------------|
| Response | GeoJSON FeatureCollection (LineString) |

---

## 4. Алгоритмы

### 4.1 `buildTrackEdges.ts`

```typescript
/** Строит P2P edges из ordered nodes трека. Skip self-loops (same place_id). */
export function buildTrackEdges(
  trackId: string,
  nodes: Array<{ id: string; seq: number; placeId: string | null; lat: number; lon: number; occurredAt: string }>,
  threatProfile: ThreatProfile,
): TrajectoryEdge[];
```

Rules:

- Require consecutive nodes with **both** `placeId` non-null
- Skip if `fromPlaceId === toPlaceId`
- One edge per (seq, seq+1)

### 4.2 `rollupSegmentCounts.ts`

```typescript
export function rollupSegmentCounts(
  edges: TrajectoryEdge[],
  opts: { asOf?: string; minCount: number },
): SegmentRollup[];
```

Key: `` `${fromPlaceId}|${toPlaceId}|${threatProfile}` ``

- `count` = number of edges
- `weight` = count (v1; v2 recency decay)
- Coords: from last edge in group (or average v2)

Filter: edge `occurredAt <= asOf`.

### 4.3 `segmentKey.ts`

SSOT hash for rollup map.

---

## 5. Миграции

```sql
CREATE TABLE trajectory_edges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id        uuid NOT NULL REFERENCES trajectory_tracks(id) ON DELETE CASCADE,
  from_node_id    uuid NOT NULL REFERENCES trajectory_nodes(id) ON DELETE CASCADE,
  to_node_id      uuid NOT NULL REFERENCES trajectory_nodes(id) ON DELETE CASCADE,
  from_place_id   uuid NOT NULL,
  to_place_id     uuid NOT NULL,
  from_seq        int NOT NULL,
  to_seq          int NOT NULL,
  threat_profile  text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  from_lat        double precision NOT NULL,
  from_lon        double precision NOT NULL,
  to_lat          double precision NOT NULL,
  to_lon          double precision NOT NULL,
  rebuild_gen     bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trajectory_edges_places ON trajectory_edges (from_place_id, to_place_id);
CREATE INDEX idx_trajectory_edges_occurred_at ON trajectory_edges (occurred_at);

CREATE TABLE trajectory_segment_rollup (
  from_place_id   uuid NOT NULL,
  to_place_id     uuid NOT NULL,
  threat_profile  text NOT NULL,
  count           int NOT NULL,
  weight          numeric NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  from_lat        double precision NOT NULL,
  from_lon        double precision NOT NULL,
  to_lat          double precision NOT NULL,
  to_lon          double precision NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_place_id, to_place_id, threat_profile)
);
```

---

## 6. Worker

### 6.1 `trackingMaterializeEdgesService.ts`

- Input: current `rebuild_gen` tracks/nodes
- Truncate edges for gen / full replace rollup
- Batch insert edges

### 6.2 `trackingRollupFlowService.ts`

- Read all edges (or per gen)
- `rollupSegmentCounts` → UPSERT `trajectory_segment_rollup`

### 6.3 CLI

```bash
tracking:materialize-edges
tracking:rollup-flow
# or chained:
tracking:rebuild --with-flow
```

Hook: auto-run after `tracking:rebuild` when flag `--with-flow`.

---

## 7. API

`TracksFlowQueryService`:

- JOIN `places` for names (optional)
- bbox: line intersects bbox (simple min/max on endpoints v1)
- ORDER BY weight DESC LIMIT

---

## 8. Web (optional v0)

- MapLibre line layer, `line-width` interpolate from `count`
- Toggle `tracks_flow` default **off**
- File: `flowCorridorLayer.ts`

---

## 9. Тесты

| ID | Test |
|----|------|
| GF-06 | 3 tracks A→B → rollup count=3 |
| GF-08 | asOf past → lower count |
| unit | self-loop skipped |
| unit | directed A→B ≠ B→A |
| integration | API GeoJSON validates |

---

## 10. DoD checklist

- [ ] Edges materialized after rebuild
- [ ] Rollup idempotent
- [ ] API + Zod + Swagger
- [ ] GF-06, GF-08 pass
- [ ] place_id coverage check in rebuild report
- [ ] MapLibre v0 optional

---

## 11. Риски

| Риск | Митигация |
|------|-----------|
| Region places → fat arteries | filter min precision v2 |
| Stale rollup after partial rebuild | same rebuild_gen sweep |
| Large rollup table | limit + bbox mandatory on API |

---

## 12. Коммиты

| # | Содержание |
|---|------------|
| C1 | domain flow + tests + migration |
| C2 | worker materialize + rollup |
| C3 | API + optional MapLibre |
