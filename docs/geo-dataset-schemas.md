# Geo datasets: field schemas and parser targets

Дата: 2026-05-07  
Основано на фактическом профиле `data/geo/artifacts` (manifest + разбор содержимого файлов).

---

## 0) Как данные хранятся в БД (важно)

Этот блок фиксирует модель хранения, чтобы не путаться между файлами-артефактами и доменными сущностями.

### `geo_dataset_file` (реестр артефактов)

- Назначение: каталог файлов из `data/geo/artifacts/manifest.json`.
- Содержит: `artifact_key`, `rel_path`, `sha256`, `byte_size`, `source_id`, `source_revision`, `clone_url`, `manifest_version`.
- Важно: это не таблица регионов/городов, а реестр файлов источника.

### `regions` (субъекты РФ)

- Назначение: доменные сущности регионов.
- Ключевые поля: `fias_id`, `kladr_id`, `iso`, `name`, `name_with_type`, `federal_district`, `front_region`, `border_region`, `source_meta`, `last_source_revision`.
- Геометрия хранится не в БД-полигоне, а как ссылка `geometry_artifact_key` -> `geo_dataset_file.artifact_key`.

### `places` (географические места внутри региона)

- Назначение: города/районы/локалитеты (`kind`).
- Ключевые поля: `region_id`, `kind`, `name`, `name_with_type`, `name_normalized`, `fias_id`, `kladr_id`, `oktmo`, `parent_place_id`, `source_meta`, `last_source_revision`.
- Поля trust/provenance: `trust_state`, `is_trusted`, `trust_score`, `trust_updated_at`, `evidence_providers`.
- Геометрия также хранится ссылкой через `geometry_artifact_key` -> `geo_dataset_file.artifact_key`.
- Важно: `place` в проекте = "место" (город, район, населенный пункт и т.п.).

### `place_evidence` (история подтверждений place)

- Назначение: append-only журнал доказательств по месту из realtime/batch enrichment.
- Ключевые поля: `place_id`, `provider`, `action`, `confidence`, `payload`, `trace_id`, `created_at`.
- Используется для:
  - последующего повышения доверия (`unverified -> verified`),
  - объяснимости в UI/админке (кто и когда подтвердил place),
  - аудита качества enricher-ов.

### `place_aliases` (алиасы для матчинга)

- Назначение: варианты названий для устойчивого поиска/резолва.
- Ключевые поля: `target_kind` (`region|place`), `region_id|place_id`, `alias`, `alias_normalized`, `source` (`auto|manual`), `is_active`.

### Ограничения удаления и порядок очистки

- В `regions` и `places` есть FK на `geo_dataset_file(artifact_key)` с `ON DELETE RESTRICT`.
- Поэтому нельзя просто делать `DELETE FROM geo_dataset_file`, пока на файлы есть ссылки.
- Для полного пересноса/очистки порядок удаления: `place_aliases` -> `places` -> `regions` -> `geo_dataset_file`.

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

## 5) Остаточные проблемы и ограничения

- Есть доля `unknown:*` в ключах `places` (не везде корректно определяется `regionCode` при объединении источников).
- Нужна безопасная чистка "сиротских" записей в `geo_dataset_file` (которые уже не в manifest и не используются в `regions/places`).
- Нужен регулярный аудит полноты `source_meta` для `places` и при необходимости отдельная миграция/расширение схемы.

---

## 6) Следующие шаги

1. Дожать mapping `regionCode` для OSM/rnekrasov-слоев, чтобы уменьшить `unknown:*`.
2. Добавить пост-seed cleanup для `geo_dataset_file`: удалять только неиспользуемые ключи.
3. Автоматизировать coverage-отчет после sync:
   - files parsed / skipped,
   - features parsed / rejected,
   - completeness полей (`fias`, `kladr`, `region_hint`, geometry).
