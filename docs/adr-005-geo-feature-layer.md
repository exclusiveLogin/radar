# ADR-005: Структурная геометрия — таблица `geo_feature`

Дата: 2026-06-03  
Статус: **Принято**

---

## Контекст

До рефактора геометрия субъектов/районов хранилась двумя способами:

1. **На диске** — файлы GeoJSON в `data/geo/artifacts/` (OSM, hflabs, rnekrasov).
2. **В БД** — строка `places.geometry_artifact_key` — ссылка на имя файла.

Проблемы:
- Нет единой таблицы геометрии для query (карта должна делать `JOIN`, а не читать файлы).
- Дублирование: `regions.geometry_artifact_key` и одноимённое поле в `places` несут один смысл, но для разных сущностей.
- `geo:db:apply` создавал тысячи недифференцированных `places` из rnekrasov, без layer-семантики.
- Поставщики hflabs и rnekrasov требовали git-clone и имели неполное покрытие НТ.

---

## Решение

### Новая таблица `geo_feature`

```sql
geo_feature (
  id            uuid PK,
  layer         text,          -- subject | district | city_district | federal_district
  region_id     uuid FK,       -- NULL для federal_district
  name          text,
  name_stem     text,          -- placeStem(name) — для parse-матча без alias-роста
  geometry      jsonb,         -- GeoJSON geometry object
  bbox          jsonb,         -- [west, south, east, north]
  centroid_lat  numeric(9,6),
  centroid_lon  numeric(9,6),
  fias_id       text UNIQUE,
  kladr_id      text,
  source_file_key text,
  source_meta   jsonb,
  is_active     boolean
)
```

### `place_geo_link`

```sql
place_geo_link (
  place_id       uuid FK → places,
  geo_feature_id uuid FK → geo_feature,
  role           text,    -- boundary | centroid
  priority       int      -- 0 = Russia_regions, 10 = supplemental (front-regions)
)
```

Связывает `place(kind=region)` с `geo_feature(layer=subject)`.

### `places` — новые поля

| Поле | Тип | Назначение |
|------|-----|-----------|
| `name_stem` | text | Стем для быстрого матча без alias-роста |
| `geo_feature_id` | uuid FK | Ссылка на геометрию; заполняется при import или parse-match |

---

## Источники данных

| Источник | Layer | catalog place? |
|----------|-------|----------------|
| `Countries/Russia_regions.geojson` | `subject` | нет (через `place_geo_link`) |
| `supplemental/front-regions.geojson` | `subject` | нет |
| `Regions/{FO}/*.geojson` | `district` | **да** |
| `Cities/*.geojson` | `city_district` | **да** |
| `Federal Districts/*.geojson` | `federal_district` | нет |

---

## Процессы инициализации

```
geo:regions:seed
  ← data/geo/catalog/regions.json (89 субъектов РФ, SSOT)
  → regions table + place(kind=region)

geo:features:import
  ← Russia_geojson_OSM (OSM-артефакты)
  → geo_feature table
  → catalog place(kind=district) для parse-матча
  → place_geo_link(subject ↔ place(kind=region))
```

### `data/geo/catalog/regions.json` — SSOT идентичности

89 записей: 83 стандартных субъекта РФ + Крым + Севастополь + 4 НТ.  
Включает: `iso`, `name`, `nameWithType`, `shortName`, `federalDistrict`, `fiasId`, `kladrId`, `frontRegion`, `borderRegion`.

**Удалены вендоры:** `hflabs-region`, `rnekrasov-geojson` — из `geo-sources.json`.

---

## Parse-матч через `geo_feature` (cascade lookup)

```
text: "Татарстан, Казань, Авиастроительный район"
        ↓
LocalityAnchor "Казань" → region_id = RU-TA
        ↓
matchPlace("Авиастроительный район", region_id=RU-TA)
  1. FIAS direct → miss
  2. alias lookup → miss
  3. findByStemInRegion(stem, region_id, preferKind=city_district)
     ← city anchor detected → prefer city_district over district
  4. legacy nameNormalized fallback
```

**Коллизия `district` vs `city_district`:** при наличии `LocalityAnchor(kind=city)` в тексте `matchPlace` предпочитает `place.kind=city_district`. `city_place_id` FK — out of scope v1.

---

## Map-слой

- `GET /api/map/regions-geojson?regionCodes=RU-MOS,RU-SPE` — lazy контуры субъектов по ISO-кодам (OSM `RegionGeometryCatalog.buildLayerByCodes`). Без `regionCodes` → **400** (не отдаём 44MB целиком).
- `GET /api/map/districts-geojson?geoFeatureIds=<uuid>` — lazy полигон одного/нескольких районов из `geo_feature`.
- `GET /api/map/districts-geojson?regionId=<uuid>` — все районы региона (admin/debug; фронт bootstrap не использует).
- `GET /api/map/districts-active-geojson` — **deprecated** (bulk fold+geo); заменён per-id fetch на фронте.

Фронт: `geoGeometryStore` кеширует `{ regionCode → Feature }` и `{ geoFeatureId → Feature }`; fetch по visible codes / place events, display districts при `minzoom ≥ 6`.

---

## Устаревшие механизмы

| Удалено | Заменено |
|---------|---------|
| `HflabsRegionProvider` | `catalog/regions.json` |
| `RnekrasovGeoJsonProvider` | OSM-only (`RussiaGeoJsonOsmProvider`) |
| `DictionariesOverrideProvider` | не нужен |
| `geo:db:apply` | `geo:features:import` |
| `hflabs-region` в `geo-sources.json` | удалён |
| `rnekrasov-geojson` в `geo-sources.json` | удалён |

---

## Известные ограничения (v1)

- `KnownLocalityCatalog` (`places.json`) оставлен как fallback для НТ-городов до верификации OSM Cities/ покрытия.
- `city_place_id` FK для sub-scoping района внутри города — v2.
- Поля `mat_parse_location.(region_id, lat, lon, precision)` — запланированы к удалению в следующей миграции после стабилизации read-model.
