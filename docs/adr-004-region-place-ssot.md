# ADR-004: region-place и единые place_aliases

## Контекст

Субъект РФ и населённый пункт — оба `places`. Таблица `regions` — словарь (ISO, флаги, геометрия). Алиасы только на `place_id`.

## Решение

- `places.kind = 'region'` — канонический субъект для матчинга («обл», «край», «область»); связь с словарём через `places.region_id` → `regions.id`.
- Уникальный индекс: один активный `place(kind=region)` на `region_id` (`uq_places_region_kind_region_active`).
- `place_aliases` — только `place_id` (constraint `chk_place_alias_place_only`).
- Ingest: `GeoValidationService.resolveRegionByAlias` → `place(kind=region)` → `regions`.
- geoParse: `place_enrichment_jobs` — по каталогу `places` без провайдера в `evidence_providers` (не из parse); `kind=region` пропускается.
- `geo:db:apply` вызывает `syncRegionCanonicalPlaces` после upsert regions.

## Операции

**Раскатка стенда / схема БД** (отдельно от parse-engine):

```powershell
npm run cold:up          # или npm run migration:run
```

**Parse-engine** (после миграции region-place):

```powershell
npm run parse-engine:manifest:import   # при смене .radar/phase.manifest.json
npm run parse-engine:rebuild
npm run parse-engine:drain               # опционально
```

`geo:db:apply` — только при обновлении vendor-справочника, не для включения region-place.

## Вне scope

- Удаление таблицы `regions`.
- `event_locations.region_id` остаётся `regions.id`.
