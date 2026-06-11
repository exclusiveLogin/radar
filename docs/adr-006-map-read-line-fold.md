# ADR-006: Write-line facts, read-line fold от курсора времени

## Контекст

Операционное состояние карты (winner, уровень, видимость) материализовалось в
`region_status_read_model` / `place_status_read_model` на write-path
(`LastWinnerReadModelProjection`, `MapStateExpirySweep`). Это давало рассинхрон
region/place, stale-флаги и зависимость от времени reparse.

## Решение

### Write-line — только факты

Append-only цепочка:

- `raw_messages` (`posted_at`)
- `parsed_events`
- `event_locations` (`occurred_at` = postedAt публикации)

Идемпотентность ingest/parse — по `postedAt`, hash, identity сообщения.
**Статусы на write-line не хранятся.**

### Read-line — вычисление от маркера времени

```text
snapshot(asOf, policies) = foldMapState(facts where occurred_at <= asOf)
```

- `asOf` по умолчанию `now`; позже — курсор таймлайна UI
- TTL 24h: факт вне окна `(asOf - TTL, asOf]` не участвует в fold
- Fade 3h: на фронте от `statusEventAt` (= winner `occurred_at`)
- Place suppress: региональный clear новее place raise (см. `isPlaceSuppressedByRegionClear`)

SSOT логики fold: `packages/shared/src/domain/region-state/mapStateFold.ts`

### Legacy read-model (deprecated cache)

`region_status_read_model`, `place_status_read_model` — **не SSOT**.
Фаза 1: live `GET /map/snapshot` читает read-model; `?asOf=` — fold из facts.
Фаза 2: cutover live на fold. Фаза 3: удаление проекции и таблиц.

## API

| Endpoint | Источник |
|----------|----------|
| `GET /map/snapshot` | read-model (live, now) |
| `GET /map/snapshot?asOf=ISO` | fold из facts (таймлайн / shadow) |

`since` и `asOf` взаимоисключающие.

## Вне scope ADR

- Raw semantic dedup (`posted_at` + normalized text)
- Переименование `parsed_events.parsed_at` → `posted_at`
- WS pollers на fold (фаза 2)
