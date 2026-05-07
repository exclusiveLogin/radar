# Geo datasets: field schemas and parser targets

Дата: 2026-05-07  
Основано на фактическом профиле `data/geo/artifacts` (manifest + разбор содержимого файлов).

## 1) Инвентарь источников

1. `hflabs-region`
   - Форматы: `region.csv`, `region.csv-metadata.json`
   - Роль: канонический справочник регионов с FIAS/KLADR/ISO.
2. `Russia_geojson_OSM`
   - Форматы: GeoJSON (95 файлов)
   - Роль: геометрия + названия регионов/районов/городов.
3. `rnekrasov-geojson`
   - Форматы: GeoJSON + JSON (8 файлов)
   - Роль: широкое покрытие `admin_level`, rich OSM-теги, альтернативный источник субъектов.

---

## 2) Схемы и полезные поля по каждому датасету

## `hflabs-region`

### Наблюдаемая структура

- CSV columns:
  - `name`, `type`, `name_with_type`, `federal_district`
  - `kladr_id`, `fias_id`, `okato`, `oktmo`, `tax_office`, `postal_code`
  - `iso_code`, `timezone`
  - `geoname_code`, `geoname_id`, `geoname_name`

### Полезные поля для Radar

- Для `regions`:
  - **обязательные**: `fias_id`, `name`, `name_with_type`
  - **очень полезные**: `kladr_id`, `iso_code`, `federal_district`, `timezone`
  - **доп. метаданные**: `okato`, `oktmo`, `tax_office`, `postal_code`, `geoname_*`
- Для `place_aliases` (уровень региона):
  - `name`, `name_with_type`, нормализованные варианты без типа.

### Рекомендованная целевая схема парсера

```ts
type RegionDraft = {
  fiasId: string;
  kladrId?: string;
  iso?: string;
  name: string;
  nameWithType?: string;
  federalDistrict?: string;
  timezone?: string;
  sourceMeta?: {
    okato?: string;
    oktmo?: string;
    taxOffice?: string;
    postalCode?: string;
    geonameCode?: string;
    geonameId?: string;
    geonameName?: string;
  };
};
```

---

## `Russia_geojson_OSM`

### Наблюдаемая структура (по факту)

- Top-level: `type="FeatureCollection"`, `features`.
- Ключи `properties`:
  - `district` (2596 вхождений)
  - `region` (85)
  - `Federal District` (8)
- Геометрии: `Polygon`/`MultiPolygon`.

### Полезные поля для Radar

- Для `regions`:
  - `properties.region` из `Countries/Russia_regions.geojson` (85 субъектов).
- Для `places`:
  - `properties.district` из `Regions/*` и `Cities/*` (в текущем наборе это фактически имена локалитетов/районов).
- Для зон макроуровня:
  - `properties["Federal District"]` (8 федеральных округов).
- Для геопривязки:
  - `geometry` + `geometry_artifact_key`.

### Риски/ограничения формата

- Нет `fias_id`/`kladr_id` в самих features.
- Семантика `district` неоднородна (может быть район, город, иной локальный объект).

### Рекомендованная целевая схема парсера

```ts
type OSMRegionFeature = {
  region: string; // из Countries
};

type OSMPlaceFeature = {
  district: string; // из Regions/Cities
  sourceLayer: "cities" | "regions";
  federalDistrictHint?: string;
};
```

---

## `rnekrasov-geojson`

### Наблюдаемая структура (по факту)

- Top-level: `type`, часто `geocoding`, `features`.
- Крупные файлы: `admin_level_10`, `admin_level_9`, `admin_level_3`, `admin_level_2`, `regions.geojson`, `russia_subjects_github.json`.
- Частые `properties`:
  - `name`, `boundary`, `admin_level`, `place`
  - `addr:region`, `addr:district`, `addr:country`
  - `population`, `official_status`, `official_name`
  - `wikipedia`, `name:ru`, `name:en`
  - локально: `cladr:code`, `okato:user`, `addr:postcode`, `alt_name`, `short_name`
  - в `russia_subjects_github.json`: `ID_1`, `NAME_1`, `NL_NAME_1`, `TYPE_1`, `ENGTYPE_1`, etc.

### Полезные поля для Radar

- Для `regions`:
  - приоритетно `russia_subjects_github.json`: `NL_NAME_1` (русское имя), `NAME_1`, `TYPE_1`.
- Для `places`:
  - `admin_level_10` + `admin_level_9`:
    - `name`, `place`, `addr:region`, `addr:district`, `admin_level`
    - `official_status`, `official_name`, `population`, `addr:postcode`.
- Для `aliases`:
  - `name:ru`, `name:en`, `alt_name`, `old_name`, `short_name`, `full_name`.
- Для enrichment hints:
  - `cladr:code`, `okato:user`, `wikipedia`.

### Рекомендованная целевая схема парсера

```ts
type RnekrasovPlaceDraft = {
  name: string;
  kind: "locality" | "district" | "settlement";
  regionNameHint?: string;    // addr:region
  districtNameHint?: string;  // addr:district
  adminLevel?: number;        // admin_level
  sourceMeta?: {
    placeTag?: string;        // place
    officialStatus?: string;
    officialName?: string;
    population?: number;
    postcode?: string;
    cladrCode?: string;
    okato?: string;
    wikipedia?: string;
  };
  aliases?: string[];         // name:ru/name:en/alt_name/old_name/short_name/full_name
};
```

---

## 3) Что забирать обязательно (MVP matrix)

## Обязательный минимум

- `hflabs-region`: все строки `region.csv` -> `regions` (+ региональные aliases).
- `Russia_geojson_OSM`:
  - `Countries/Russia_regions.geojson` -> геометрия субъектов;
  - `Regions/**` + `Cities/**` -> place-кандидаты с `district`.
- `rnekrasov-geojson`:
  - `russia_subjects_github.json` -> нормализация названий субъектов;
  - `admin_level_10` и `admin_level_9` -> основная масса населенных пунктов/районов.

## Желательно (после MVP)

- `admin_level_3` для промежуточной иерархии.
- `Federal Districts/*` как отдельный слой аналитики.
- Отдельная дедупликация multilingual aliases.

---

## 4) Правила нормализации перед merge

- `name_normalized`:
  - lower-case, `ё -> е`, trim, collapse spaces, убрать служебные кавычки.
- `admin_level`:
  - парсить как число (`Number(admin_level)`), хранить в `source_meta`.
- Region mapping priority:
  1. `fias_id` (если есть),
  2. `kladr_id` (если есть),
  3. `region name` exact normalized,
  4. `alias` match.
- Place dedupe key:
  - `fias_id` if present else `region_id + kind + name_normalized`.

---

## 5) Проблемы текущего контура, блокирующие полноценный ingest

- В `geo-sync` провайдерах сейчас частичный проход (`slice(0, 20)` для geojson-файлов) — обрабатывается не весь источник.
- `geo-sync-plan` использует placeholder current-state (diff не сравнивает с фактическими данными БД).
- `geo-sync-apply` не формирует `placeRows`/`aliasRows` (по факту в БД остаются пустые `places/place_aliases`).

---

## 6) План подгонки парсеров (следующий шаг)

1. Убрать лимиты `slice(0, 20)` и читать все файлы по source.
2. Разделить парсеры по file-class:
   - `Russia_geojson_OSM`: countries/regions/cities/federal-districts.
   - `rnekrasov`: subjects/admin_level_10/admin_level_9/admin_level_3.
3. Ввести явные DTO `RegionDraftV2`/`PlaceDraftV2`/`AliasDraftV2` с `source_meta`.
4. Реализовать фактическое заполнение `placeRows` и `aliasRows` в apply.
5. Добавить coverage-отчет после sync:
   - files parsed / skipped
   - features parsed / rejected
   - fields completeness (`fias`, `kladr`, `region_hint`, geometry).
