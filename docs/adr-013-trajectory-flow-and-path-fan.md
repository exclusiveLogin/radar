# ADR-013: Flow-коридоры (P2P rollup) и historical path fan

Дата: 2026-06-14  
Статус: **Предложено**

Связано: [ADR-007](./adr-007-trajectory-graph-kalman-worker.md), [ADR-011](./adr-011-deckgl-track-rendering.md), [features/tracking-flow-corridors.md](./features/tracking-flow-corridors.md), [features/tracking-historical-path-fan.md](./features/tracking-historical-path-fan.md), [roadmap](./roadmap-tracking-forecasting.md), [sdd/tracking/plan.md](./sdd/tracking/plan.md)

---

## Контекст

Tracking-домен ([ADR-007](./adr-007-trajectory-graph-kalman-worker.md)) строит **L1 — индивидуальные треки** из `event_locations` / event-places через Kalman. Они нужны для:

- velocity, bearing, прогноза (эллипс P);
- Kill/Pass ([ADR-010](./adr-010-pvo-kill-pass-layers.md));
- аналитики по конкретной цели.

OSINT-поток **не даёт стабильных object ID**. Несколько целей могут проходить через одни и те же места; «бифуркация» в Kalman (MHT / track split) резко усложняет worker и не обязательна для аналитического UX.

**Наблюдение:** на карте аналитику важнее видеть:

1. **Артерии** — где часто повторяется маршрут «место → место» (коридоры движения).
2. **Вероятностные хвосты** — куда **historically** уходили цели из текущей последней точки active-трека.

**Принципы:** Read-side projection, Edge aggregation (не whole-track intersect), Historical path prior (не multi-hypothesis Kalman).

**Value:** высокая — тактическая картина «куда обычно летят» без усложнения Kalman.

---

## Решение (два слоя)

```text
┌─────────────────────────────────────────────────────────────┐
│ L1 — Individual tracks (Kalman, ADR-007)                    │
│   trajectory_tracks + trajectory_nodes                      │
│   SSOT: kinematics, prediction, Kill/Pass                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ materialize edges
┌─────────────────────────────────────────────────────────────┐
│ L2 — Flow corridors (read projection, этот ADR)             │
│   P2P-сегменты + rollup count/weight → толщина на карте     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ on-demand / batch index
┌─────────────────────────────────────────────────────────────┐
│ L2b — Historical path fan (read projection, этот ADR)       │
│   suffix-пути из anchor place + n nodes → частотность       │
└─────────────────────────────────────────────────────────────┘
```

**Kalman не бифурцирует треки.** Fork/split — **не** в state filter, а в **read-side аналитике** поверх материализованных треков.

---

## L1 — что остаётся без изменений по смыслу

Worker ([ADR-007](./adr-007-trajectory-graph-kalman-worker.md)) по-прежнему:

```text
facts → mode (ADR-008) → link → DISTINCT? → gate → Kalman → persist
```

Дополнение к `trajectory_nodes` (additive migration):

| Поле | Назначение |
|------|------------|
| `place_id` | uuid FK → `places`, nullable; SSOT якоря «event-place» для L2 |
| `threat_profile` | `uav` \| `rocket` \| `balloon` \| `unknown` — denormalized для rollup filter |

`place_id` берётся из `event_locations.place_id` на момент сборки трека. Node без `place_id` участвует в L1 (lat/lon), но **не** в place-based rollup L2 (v1).

---

## L2 — Flow corridors (P2P rollup)

### Идея

Трек — цепочка nodes. Разбиваем на **ориентированные P2P-отрезки**:

```text
Track:  P0 → P1 → P2 → P3
Edges:  (P0,P1), (P1,P2), (P2,P3)
```

Агрегируем по ключу **направленной пары мест**, не по целому треку:

```typescript
type SegmentKey = {
  fromPlaceId: string;
  toPlaceId: string;
  threatProfile: ThreatProfile; // опционально в ключе rollup
};
```

При совпадении `fromPlaceId + toPlaceId` у разных треков → **один rollup** с `count++`.

На карте совпадающие отрезки визуально складываются в **артерии**; whole-track intersect не нужен.

### Алгоритм rollup (v1)

1. После persist/rebuild L1: `SELECT` все `trajectory_nodes` с `place_id IS NOT NULL`, упорядоченные `(track_id, seq)`.
2. Для каждой пары `(node_i, node_{i+1})` где оба имеют `place_id` и `node_i.place_id ≠ node_{i+1}.place_id`:
   - построить `SegmentKey`;
   - `count += 1`;
   - `lastSeenAt = max(lastSeenAt, node_{i+1}.occurred_at)`;
   - сохранить representative coordinates `(from_lat/lon, to_lat/lon)` — от medoid или последнего наблюдения.
3. Фильтр шума: `count >= MIN_SEGMENT_COUNT` (default 2).
4. Time Machine: при query `occurred_at <= asOf` — rollup считается только по nodes с `occurred_at <= asOf` (on-read v1 или partial materialized v2).

### DISTINCT и дубли (связь с обсуждением ADR-009)

Если при сборке L1 последняя точка трека ≈ new candidate (**DISTINCT** — same place + proximity + Δt), Kalman **не** вызывается, новый node не создаётся (или только `source_refs` merge).  
→ L2 не получает ложных micro-edges от cross-channel дублей.

Разные координаты / разные places из разных каналов — **валидные** edges; rollup отражает реальную частотность маршрута.

### Хранение (предложение)

```sql
-- Материализованные рёбра (per track, для rebuild rollup и debug)
trajectory_edges (
  id              uuid PK,
  track_id        uuid FK → trajectory_tracks,
  from_node_id    uuid FK → trajectory_nodes,
  to_node_id      uuid FK → trajectory_nodes,
  from_place_id   uuid,
  to_place_id     uuid,
  from_seq        int,
  to_seq          int,
  threat_profile  text,
  occurred_at     timestamptz,  -- max(from, to) или to_node.occurred_at
  created_at      timestamptz
)

-- Агрегат L2 (пересчитывается worker job)
trajectory_segment_rollup (
  from_place_id   uuid,
  to_place_id     uuid,
  threat_profile  text,
  count           int,
  weight          numeric,      -- count × recency_factor (v1: = count)
  last_seen_at    timestamptz,
  from_lat        numeric,
  from_lon        numeric,
  to_lat          numeric,
  to_lon          numeric,
  updated_at      timestamptz,
  PRIMARY KEY (from_place_id, to_place_id, threat_profile)
)
```

Индексы: `(from_place_id)`, `(to_place_id)`, `(last_seen_at)`, `(count DESC)`.

### SSOT pure functions

`packages/shared/src/domain/tracking/flow/`:

| Модуль | Функция |
|--------|---------|
| `buildTrackEdges.ts` | nodes[] → `TrajectoryEdge[]` |
| `rollupSegmentCounts.ts` | edges[] → `SegmentRollup[]` |
| `segmentKey.ts` | `(fromPlaceId, toPlaceId, profile?) → SegmentKey` |
| `applyAsOfFilter.ts` | nodes/edges filter by `occurred_at <= asOf` |

Worker — оркестратор; API — read adapter.

### API (read-side)

| Endpoint | Назначение |
|----------|------------|
| `GET /map/tracks/flow` | GeoJSON LineString features, `weight`/`count` в properties |
| `GET /map/tracks/flow/places/:placeId` | исходящие/входящие rollup из place (sidebar) |

Query: `since`, `until`, `asOf`, `bbox`, `threatProfile`, `minCount`, `limit`.

GeoJSON property:

```typescript
{
  fromPlaceId: string;
  toPlaceId: string;
  count: number;
  weight: number;
  lastSeenAt: string;
  threatProfile: string;
}
```

UI: толщина линии ∝ `weight` (см. [Feature: flow corridors](./features/tracking-flow-corridors.md)).

---

## L2b — Historical path fan (вероятностные хвосты)

### Идея

Для **active track** в режиме prediction (`asOf >= lastNode.occurredAt`):

1. Взять **anchor** = `place_id` последнего node (или explicit `anchorPlaceId`).
2. Найти все **historical** треки (status любой, `occurred_at <= asOf`), содержащие node с этим `place_id`.
3. Для каждого такого трека извлечь **suffix**: anchor → следующие `n` nodes (default `n=5`, tunable) или до `SUFFIX_MAX_MS`.
4. Нормализовать suffix в **path signature** — цепочка `place_id[]` (или hash).
5. Агрегировать: `pathSignature → { count, coordinates[] }`.
6. Отдать top-K paths (default K=10) с `count` для толщины линии.

```text
Исторические треки через anchor P:

  P → A → B     (count 12)
  P → C → D     (count 7)
  P → A → E     (count 3)

На карте: три ветки от P, толщина ∝ count
```

**Смысл:** behavioral prior — «куда обычно уходили из этой точки».  
**Не путать** с Kalman ellipse ([Feature-004](./features/tracking-confidence-ellipse.md)) — физическая неопределённость vs историческая частотность.

### Индекс (v1 on-read, v2 materialized)

```sql
-- v2: ускорение fan-query
trajectory_place_index (
  place_id        uuid,
  track_id        uuid,
  node_id         uuid,
  seq             int,
  occurred_at     timestamptz,
  threat_profile  text,
  PRIMARY KEY (place_id, track_id, node_id)
)
```

Заполняется тем же worker job после persist edges.

### SSOT pure functions

| Модуль | Функция |
|--------|---------|
| `extractPathSuffixes.ts` | tracks at place → suffix[] |
| `aggregatePathFan.ts` | suffixes → ranked paths |
| `pathSignature.ts` | placeId[] → string hash |

### API

| Endpoint | Назначение |
|----------|------------|
| `GET /map/tracks/:id/path-fan` | fan от last node active-трека |
| `GET /map/tracks/path-fan?anchorPlaceId=` | fan от произвольного place |

Query: `asOf`, `n` (suffix length), `topK`, `threatProfile`, `since`, `until`, `minCount`.

Response:

```typescript
type HistoricalPathFan = {
  anchorPlaceId: string;
  anchorCoordinates: [lon, lat];
  asOf: string;
  paths: Array<{
    placeSequence: string[];
    count: number;
    weight: number;
    coordinates: Array<[lon, lat]>;
  }>;
};
```

---

## Worker: порядок job

```text
tracking:rebuild-tracks     // L1 (ADR-007)
  → tracking:materialize-edges
  → tracking:rollup-flow      // L2
  → tracking:index-places     // L2b index (v2)
```

Идемпотентность: full rebuild rollup безопасен; checkpoint по `last_at` треков — incremental v2.

**Не блокирует** hot path ingest/parse.

---

## Time Machine (`asOf`)

Единый курсор из [ADR-006](./adr-006-map-read-line-fold.md):

| Слой | Правило |
|------|---------|
| L1 tracks API | nodes с `occurred_at <= asOf`; predict только если track active |
| L2 flow | rollup только по edges с `occurred_at <= asOf` |
| L2b path fan | historical suffix только из nodes с `occurred_at <= asOf` |

При движении ползунка назад артерии и fan **сужаются** — воспроизводимая аналитика.

---

## Threat profile

Профили угроз (`uav`, `rocket`, `balloon`) — SSOT в `resolveThreatProfile()` ([ADR-007](./adr-007-trajectory-graph-kalman-worker.md), обсуждение).

| Использование | Поведение |
|---------------|-----------|
| L1 link/gate | max velocity, max gap |
| L2 rollup key | отдельный rollup per profile (default filter на API) |
| L2b path fan | filter historical tracks by profile |

Query `threatProfile=unknown` или omit — агрегат по всем (explicit opt-in).

---

## Визуализация (кратко)

| Слой | Рендер | Стиль |
|------|--------|-------|
| L1 body tracks | Deck.gl PathLayer / TripsLayer ([ADR-011](./adr-011-deckgl-track-rendering.md)) | temporal color |
| L2 flow | Deck.gl PathLayer, `getWidth(d => f(d.weight))` | нейтральный коридор, под L1 |
| Kalman ellipse | GeoJsonLayer | полупрозрачный polygon |
| L2b path fan | Deck.gl PathLayer | пунктир / другой hue, толщина ∝ count |

Z-order снизу вверх: flow → fan → tracks → ellipse.

Детали UX: [tracking-flow-corridors.md](./features/tracking-flow-corridors.md), [tracking-historical-path-fan.md](./features/tracking-historical-path-fan.md).

---

## Зависимости

| Зависимость | Статус |
|-------------|--------|
| ADR-007 — L1 треки в БД | блокер |
| `trajectory_nodes.place_id` populated | блокer L2 |
| ADR-011 — Deck.gl overlay | блокер UI (можно MapLibre line-width v0) |
| Feature-004 — ellipse | параллельно, не блокер L2 |

---

## Не делаем

- Multi-Hypothesis Tracking / Kalman track split
- Whole-track geometric intersect (O(tracks²))
- Semantic dedup текстов сообщений в rollup
- Замена L1 треков на только flow layer
- Realtime rollup на каждый ingest event (только batch/incremental worker)
- v1: spatial snap (H3) вместо place_id — backlog v2

---

## Последствия

| Плюс | Минус |
|------|-------|
| Артерии без усложнения Kalman | Качество L2 = качество place_id |
| Path fan даёт «куда usually» без MHT | Не идентифицирует конкретную цель сейчас |
| P2P rollup O(edges) масштабируется | Region-level places → грубые коридоры |
| Чистая read-side projection | Доп. таблицы + worker job |

---

## Критерии принятия

- Golden fixture: 3 трека с общим отрезком A→B → rollup `count=3`, одна feature на карте
- Golden fixture: DISTINCT duplicate не создаёт edge A→A
- Golden fixture: anchor P, 2 historical suffix → path-fan с 2 paths, counts корректны
- `asOf` в прошлом уменьшает count vs `asOf=now`
- API валидируется Zod; unit-тесты rollup + fan в `@radar/shared`

---

## Фаза внедрения (предварительно)

| Фаза | Содержание |
|------|------------|
| **2a** | L1 stable + `place_id` на nodes |
| **2b** | L2 flow rollup + `GET /map/tracks/flow` |
| **2c** | L2b path fan + `GET /map/tracks/:id/path-fan` |
| **4** | Deck.gl width encoding + toggle layers |

Параллельно с Kill/Pass (фаза 3) допустимо — разные read endpoints.

---

## Открытые вопросы

1. `MIN_SEGMENT_COUNT`: 2 vs 3 на prod noise.
2. Recency weight: `weight = count` vs exponential decay по `last_seen_at`.
3. Self-loop edges (`place_id` одинаковый, coords чуть сдвинулись) — skip или отдельный тип «loiter»?
4. Path fan: фиксированные `n` nodes vs `SUFFIX_MAX_MS` — что primary?
5. Materialized rollup vs on-read для MVP на ~150k nodes/month.
6. Объединять Kill/Pass segments с flow layer в unified `GET /map/tracks/layers` или отдельные endpoints.

---

## Связь с пересмотром ADR-009

Pre-collapse как отдельный heavy step **не обязателен** для L2, если L1 использует:

- **DISTINCT** (same place ≈ last node → skip);
- **R(precision)** при correct;
- **innovation gating** для outliers.

ADR-009 может быть superseded частично; L2 опирается на **чистые edges** L1, а не на collapse-кластеры.
