# Фазовые команды (wipe / reset / clear / run)

Пайплайн: **vendor → ingest → parse → geo** (+ structural **geo-catalog** в БД).

## Семантика

| Действие | Смысл |
|----------|--------|
| **wipe** | Состояние «фаза раскатана, пользовательского контента нет» |
| **reset** | Снять только **обогащение** (координаты, trust, очереди geo), базовые строки остаются |
| **clear** | Только **очереди** (`phase_coverage`, `place_enrichment_jobs`, cancel `phase_runs`) |
| **run** | Раскатка фазы (без удаления) |

Мутирующие команды поддерживают **`--dry-run`** (или `--dry`).

---

## По фазам

### vendor (диск)

| Команда | Эффект |
|---------|--------|
| `vendor:run` | `geo:vendor` + `geo:sync` |
| `vendor:wipe` | Удалить `data/geo/vendor`; `artifacts` — только `--with-artifacts` |

### ingest

| Команда | Эффект |
|---------|--------|
| `ingest:run` | backfill всех каналов (= `parse-engine:ingest:backfill`) |
| `ingest:reset` | **noop** |
| `ingest:wipe` | `raw_messages` + parsed, evloc, parse_attempts, ingest cursors/backfill |

**Не трогает:** places, regions, geo_feature.

### parse

| Команда | Эффект |
|---------|--------|
| `parse:run` | `parse-engine:rebuild:drain` |
| `parse:reset` | **noop** |
| `parse:wipe` | parsed + evloc; **raw остаётся** |

### geo (places как актив)

| Команда | Эффект |
|---------|--------|
| `geo:catalog:import` | tabular → frontline → osm_geometry → adjacency ([runbook](./runbook/geo-clean-rebuild.md)) |
| `geo:catalog:reset -- --confirm` | wipe гео-справочника (без raw/parsed) |
| `geo:run` | legacy → предпочтительно `geo:catalog:import` |
| `geo:reset` | Обнулить centroid/bbox/trust на places; jobs/evidence |
| `geo:wipe` | DELETE places + aliases; **каталог** (regions, geo_feature) **остаётся** |

> ⚠️ `geo:wipe` обнуляет `event_locations.place_id` перед удалением (FK RESTRICT). Данные evloc остаются.

### geo-catalog (structural БД)

| Команда | Эффект |
|---------|--------|
| `geo-catalog:wipe` | regions, geo_feature, place_geo_link, geo_dataset_file |

Перед `geo-catalog:wipe` обычно нужен `geo:wipe` (пустые places).

---

## Составные

| Команда | Эффект |
|---------|--------|
| `ingest-parse:wipe` | = `ingest:wipe` |
| `vendor-ingest-parse-geo:wipe` | ingest-parse + geo:wipe + geo-catalog:wipe (БД) |
| `system:reset -- --confirm` | wipe БД + legacy `geo:init`; диск не трогает |
| `system:reset -- --confirm --wipe-only` | только wipe БД → `geo:catalog:import` |

---

## Очереди

| Команда | Эффект |
|---------|--------|
| `phase:ingest:clear` | phase_coverage + cancel runs (ingest) |
| `phase:geo:clear` | place_enrichment_jobs + cancel runs (geo) |
| `phase:all:clear` | обе очереди |

---

## Legacy-алиасы

| Старое | Новое |
|--------|-------|
| `parse-engine:clear` | `ingest-parse:wipe` |
| `parse-engine:reset` | `parse:wipe` |
| `parse-engine:clear:raw` | только raw — оставлено |
| `parse-engine:system:wipe` | `vendor-ingest-parse-geo:wipe` |
| `parse-engine:catalog:wipe` | `geo:wipe` (+ при необходимости `parse:wipe`) |

---

## Что никогда не удаляется wipe-командами

`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `.env`, Telegram session.
