> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.

# ADR-006: Write-line facts, read-line fold от курсора времени

## Контекст

Операционное состояние карты (winner, уровень, видимость) раньше материализовалось в
`region_status_read_model` / `place_status_read_model` на write-path
(`LastWinnerReadModelProjection`, `MapStateExpirySweep`). Это давало рассинхрон
region/place, stale-флаги и зависимость от времени reparse.

**Статус (2026):** миграция завершена. Materialized read_model удалён из кода и БД.

## Решение

### Write-line — только факты

Append-only цепочка:

- `mat_ingest_raw` (`posted_at`)
- `mat_parse_event`
- `mat_parse_location` (`occurred_at` = postedAt публикации)

Рдемпотентность ingest/parse — по hash и identity сообщения.
**Статусы на write-line не хранятся.**

Коррекция сообщения (edit/revision) — **новый raw + parse**, тот же `posted_at`;
fold на read-side выбирает winner (clear бьёт raise при том же времени).

### Read-line — вычисление от маркера времени

```text
snapshot(asOf, policies) = foldMapState(facts where occurred_at <= asOf)
```

- `asOf` по умолчанию 
ow`; UI — ползунок таймлайна (`MapTimelineBar`)
- TTL 24h: факт вне окна `(asOf - TTL, asOf]` не участвует в fold
- Fade 3h: на фронте от `statusEventAt` (= winner `occurred_at`)
- Place suppress: региональный clear новее place raise (см. `isPlaceSuppressedByRegionClear`)

SSOT логики fold: `packages/shared/src/domain/region-state/mapStateFold.ts`  
SSOT загрузки фактов: `packages/shared/src/domain/region-state/mapFactsLoader.ts`

### Архитектура API

- `MapFactsRepository` — загрузка фактов
- `MapSnapshotQueryService` — fold + enrich → `MapSnapshot`
- `MapQueryService` — REST adapter
- `MapFoldRealtimePoller` — WS diff fold snapshot(now)

## API

| Endpoint | Рсточник |
|----------|----------|
| `GET /map/snapshot` | fold на 
ow` |
| `GET /map/snapshot?asOf=ISO` | fold на маркер времени (таймлайн) |
| `GET /map/snapshot?since=ISO` | fold на 
ow`, фильтр по `statusEventAt > since` |

`since` и `asOf` взаимоисключающие.

## Layered transport (state + geo)

Fold остаётся SSOT правил; transport разделён на независимые read-слои:

| Endpoint | Содержимое | Fold |
|----------|------------|------|
| `GET /map/regions-state` | region winners + layout/centroid | да (region-scoped facts) |
| `GET /map/places-state` | active places (lat/lon, geoFeatureId) | да (place facts + suppress) |
| `GET /map/regions-geojson?regionCodes=` | OSM контуры субъектов | нет |
| `GET /map/districts-geojson?geoFeatureIds=` | полигоны районов | нет |
| `GET /map/snapshot` | composite (legacy / Time Machine shortcut) | да |

**Bootstrap фронта:** `regions-state` + `places-state` + WS deltas; geo lazy по visible region codes и `geoFeatureId` place-событий.

**Poller:** regions fold каждые 1s, places fold каждые 3s; WS seed — regions-only (`places: []`).

Рндексы read-path: `mat_parse_location(occurred_at)`, `(raise, occurred_at)`, `mat_ingest_raw(posted_at)`.

## Вне scope ADR

- Raw semantic dedup cross-channel (`posted_at` + normalized text)
- Переименование `mat_parse_event.parsed_at` → `posted_at` в схеме БД

