# SDD: Tracking — Фаза 2c — Historical path fan

Статус: **ready for implementation**  
Work packages: T2c.1–T2c.4  
ADR: [013](../../adr-013-trajectory-flow-and-path-fan.md)  
Feature: [path fan](../../features/tracking-historical-path-fan.md)

**Критерий входа:** фаза 1; желательно 2b (rollup infra). Ellipse (фаза 2) — для combined UX, не блокер API.

---

## 1. Scope / Out of scope

### In scope

- Domain: suffix extract, path signature, aggregate fan
- Table `trajectory_place_index` (materialized)
- API `GET /map/tracks/:id/path-fan`, `GET /map/tracks/path-fan?anchorPlaceId=`
- Web: fan layer + legend; show only active + future asOf
- Combined UX with ellipse (different styles)

### Out of scope

- MHT / constrain Kalman by chosen branch
- Percent labels on map
- Deck.gl (фаза 4)

---

## 2. Архитектура

```text
Worker (after edges):
  trajectory_place_index(place_id, track_id, node_id, seq, occurred_at, threat_profile)

GET path-fan:
  1. Resolve anchor = last node place_id OR anchorPlaceId param
  2. Find tracks via index WHERE place_id = anchor AND occurred_at <= asOf
  3. For each track: extract suffix [anchorSeq .. anchorSeq+n]
  4. pathSignature(placeId[]) → aggregate counts
  5. topK paths → coordinates from nodes
```

**Смысл:** historical behavioral prior, не kinematic prediction.

---

## 3. Контракты

### 3.1 Zod — `packages/shared/src/schemas/map/tracks-path-fan.ts`

```typescript
export const pathFanQuerySchema = z.object({
  asOf: z.string().datetime(),
  n: z.coerce.number().int().min(1).max(20).default(5),
  topK: z.coerce.number().int().min(1).max(50).default(10),
  minCount: z.coerce.number().int().min(1).default(2),
  threatProfile: threatProfileSchema.optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

export const pathFanPathSchema = z.object({
  placeSequence: z.array(z.string().uuid()),
  placeNames: z.array(z.string()).optional(),
  count: z.number().int(),
  weight: z.number(),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
  signature: z.string(),
});

export const historicalPathFanResponseSchema = z.object({
  anchorPlaceId: z.string().uuid(),
  anchorCoordinates: z.tuple([z.number(), z.number()]),
  asOf: z.string().datetime(),
  suffixLength: z.number().int(),
  trackId: z.string().uuid().optional(),
  paths: z.array(pathFanPathSchema),
});
```

### 3.2 API

| GET | `/map/tracks/:id/path-fan` | Fan от last node трека |
| GET | `/map/tracks/path-fan?anchorPlaceId=` | Fan от place |

** Preconditions (controller):**

- Track exists; for `:id` route — use last node with `place_id`
- Return `paths: []` if `asOf <= lastNode.occurredAt` (not error)

---

## 4. Алгоритмы

### 4.1 `pathSignature.ts`

```typescript
/** Стабильный ключ цепочки place IDs (anchor included). */
export function pathSignature(placeIds: string[]): string;
```

Implementation: `placeIds.join('→')` or hash SHA256 truncated.

### 4.2 `extractPathSuffixes.ts`

```typescript
export type IndexedTrackNodes = Map<string, Array<{ seq: number; placeId: string; lat: number; lon: number; occurredAt: string }>>;

export function extractPathSuffixes(
  trackNodes: IndexedTrackNodes,
  anchorPlaceId: string,
  n: number,
  asOf: string,
): Array<{ trackId: string; placeSequence: string[]; coordinates: Array<[lon, lat]> }>;
```

Rules:

- Find **first** occurrence of anchor in track where `occurredAt <= asOf` (v1)
- Take up to 
` nodes **after** anchor (including anchor as [0])
- Skip tracks with suffix length < 2 places

### 4.3 `aggregatePathFan.ts`

```typescript
export function aggregatePathFan(
  suffixes: Array<{ placeSequence: string[]; coordinates: Array<[number, number]> }>,
  opts: { minCount: number; topK: number },
): PathFanPath[];
```

- Group by `pathSignature`
- `count` = tracks in group
- `coordinates`: medoid path or longest representative v1
- Sort desc by count, take topK

---

## 5. Миграции

```sql
CREATE TABLE trajectory_place_index (
  place_id        uuid NOT NULL,
  track_id        uuid NOT NULL REFERENCES mat_track(id) ON DELETE CASCADE,
  node_id         uuid NOT NULL REFERENCES mat_track_node(id) ON DELETE CASCADE,
  seq             int NOT NULL,
  occurred_at     timestamptz NOT NULL,
  threat_profile  text NOT NULL,
  rebuild_gen     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (place_id, track_id, node_id)
);

CREATE INDEX idx_tpi_track ON trajectory_place_index (track_id);
CREATE INDEX idx_tpi_occurred_at ON trajectory_place_index (occurred_at);
```

Populate: all nodes with `place_id IS NOT NULL`.

---

## 6. Worker

`trackingIndexPlacesService.ts`:

- Run after `materialize-edges` or with rebuild
- DELETE old gen; INSERT from nodes

CLI: `tracking:index-places` or `--with-flow` chain includes index.

---

## 7. Web

### 7.1 Files

- `pathFanLayer.ts` — MapLibre line layers per path rank
- `tracksPathFanStore.ts`
- `useTracksPathFan.ts` — fetch when selected track active && asOf > lastAt

### 7.2 Display rules

| Condition | Action |
|-----------|--------|
| No selected track | hide fan |
| asOf ≤ lastAt | hide fan |
| active + future asOf | fetch fan + show with ellipse |

Style: dashed lines, warm palette, width ∝ count (reuse `fanLineWidth` from feature doc).

Legend: «Исторические маршруты» vs «Зона прогноза (Kalman)».

---

## 8. Тесты

| ID | Test |
|----|------|
| GF-07 | anchor P, 2 suffixes → counts 7 and 3 |
| GF-08 | asOf past → fewer paths / lower counts |
| unit | signature stable |
| unit | n=5 truncates long track |
| integration | empty fan when asOf before last obs |

---

## 9. DoD checklist

- [ ] Index populated on rebuild
- [ ] API both routes work
- [ ] GF-07, GF-08 pass
- [ ] UI fan + ellipse together with distinct legend
- [ ] Fan hidden on historical replay
- [ ] Zod + Swagger

---

## 10. Риски

| Риск | Mitigation |
|------|------------|
| Multiple anchors same track | v1: first occurrence only |
| Sparse history at place | empty paths, no error |
| Ambiguous place granularity | document in tooltip |

---

## 11. Коммиты

| # | Содержание |
|---|------------|
| C1 | domain + index migration + tests |
| C2 | worker index job |
| C3 | API + web layer |
