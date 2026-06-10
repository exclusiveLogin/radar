# Runbook: сброс БД, каталог geo, backfill и перепривязка событий

PowerShell, корень репозитория. Нужны `DATABASE_URL`, `RADAR_STORAGE_MODE=db`, Postgres.

**Перед мутирующими командами:** остановить `npm run dev` (Ctrl+C), чтобы worker/api не писали в БД параллельно.

---

## Пайплайн (что к чему)

```
[Telegram / backfill]
        │
        ▼
  raw_messages              ← ingest
        │
        ▼
  parsed_events             ← parse (матч к places в БД)
  event_locations
        │
        ▼
  place_enrichment_jobs     ← geo (dadata/nominatim)
        │
        ▼
  places (trust, coords)    ← обогащение
  *_status_read_model       ← карта
```

**Geo-каталог (staging, не runtime parse):**

```
data/geo/catalog/  →  geo:catalog:import
  [1/4] tabular      regions + FIAS places
  [2/4] frontline    places.json override
  [3/4] osm_geometry geo_feature + link к places
  [4/4] adjacency    region_adjacency
```

После `geo:catalog:import` places получают **новые UUID**. Старые `event_locations.place_id` без reparse **не привяжутся** к новому справочнику.

---

## Команды по убыванию импакта

| # | Команда | Импакт | Удаляет | Оставляет |
|---|---------|--------|---------|-----------|
| 1 | `parse-engine:system:wipe -- --confirm` | 🔴 max | raw + parsed + карта + places + regions + geo_feature | конфиг ingest/фаз, схема БД |
| 2 | `parse-engine:clear` | 🟠 | raw + parsed + карта + cursors | **places, regions, geo_feature** |
| 3 | `geo:catalog:reset -- --confirm` | 🟠 | гео-справочник целиком | raw, parsed (`event_locations.place_id` → NULL) |
| 4 | `parse-engine:catalog:wipe` | 🟡 | places, aliases, parsed, read-model | regions, geo_feature, raw |
| 5 | `geo-catalog:wipe` | 🟡 | regions, geo_feature, place_geo_link | places должны быть пусты |
| 6 | `ingest-parse:wipe` | 🟡 | = ingest:wipe (raw + parsed + карта) | places, regions |
| 7 | `parse-engine:reset` | 🟢 | parsed + карта + очереди; **raw остаётся** | raw, places, regions |
| 8 | `geo:wipe` | 🟢 | places, aliases | regions, geo_feature, raw |
| 9 | `geo:reset` | 🟢 | trust/coords/bbox на places, jobs | строки places |
| 10 | `parse-engine:catalog:purge-garbage` | ⚪ | деактивирует мусорные ingest-places | остальное |
| 11 | `phase:all:clear` | ⚪ | только очереди фаз | данные |

Все wipe/reset поддерживают **`-- --dry-run`** (посмотреть план без SQL).

### `parse-engine:system:wipe` — детально

Три фазы подряд:

| Фаза | Таблицы / эффект |
|------|------------------|
| ingest:wipe | `raw_messages`, `parsed_events`, `event_locations`, `parse_attempts`, `phase_runs`, `domain_events`, read-model карты, ingest cursors/backfill, jobs, evidence |
| geo:wipe | `places`, `place_aliases` |
| geo-catalog:wipe | `regions`, `geo_feature`, `place_geo_link`, `geo_dataset_file`, `region_state_*` |

**Не трогает:** `channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, файлы `data/geo/catalog` и `data/geo/artifacts` на диске.

> `system:reset` и `parse-engine:system:wipe` **не** удаляют `data/geo/artifacts` — снапшот OSM нужен для `geo:catalog:import` (шаг osm). Свежий клон: `npm run vendor:wipe` (только vendor/) → `geo:vendor` → `geo:sync`. Полный снос artifacts: `vendor:wipe -- --with-artifacts`.

---

## `reset` vs `rebuild` — привязка к новым places

| Команда | Смысл |
|---------|--------|
| `parse-engine:reset` | Удаляет старые parse-результаты, сбрасывает карту, ставит catch-up. **Сам parse не запускает.** |
| `parse-engine:rebuild` | Сброс + **прогон parse по всем `raw_messages`** → матч к актуальным places в БД |
| `parse-engine:rebuild:drain` | rebuild + scheduled ingest + **geo:drain** (обогащение) |

> После переливки каталога нужен **`rebuild`** (или `rebuild:drain`), не только `reset`.

---

## Сценарий A — чистая система с нуля

Полный wipe → каталог → backfill → parse → geo.

```powershell
# 1. Полный сброс контента БД
npm run parse-engine:system:wipe -w @radar/worker -- --confirm

# 2. Миграции (если после pull / новые таблицы)
npm run migration:run -w @radar/api

# 3. Загрузка каталогов (4 шага)
npm run geo:catalog:import -w @radar/api

# 4. Backfill raw (после wipe архив пуст)
npm run parse-engine:ingest:backfill -w @radar/worker
# или: npm run ingest:run -- --channels=<key>

# 5. Перепарсить всё к новым places + geo-обогащение
npm run parse-engine:rebuild:drain -w @radar/worker

# 6. Dev-стек
npm run dev
```

---

## Сценарий B — перелить только каталог (raw сохранить)

```powershell
# 1. Сброс гео-справочника
npm run geo:catalog:reset -w @radar/api -- --confirm

# 2. Чистый import
npm run geo:catalog:import -w @radar/api

# 3. Перепривязать события к новым places
npm run parse-engine:rebuild:drain -w @radar/worker
```

`parse-engine:reset` здесь **недостаточен** — он только очистит parsed, но не пересчитает матч. Альтернатива: `reset` + долгий `worker:dev` (catch-up), если не нужен полный прогон сразу.

---

## Сценарий C — только перепарс (каталог не менялся)

```powershell
npm run parse-engine:reset -w @radar/worker
npm run parse-engine:rebuild -w @radar/worker
# или одной командой:
npm run parse:run
```

---

## Geo-каталог — команды

| Команда | Назначение |
|---------|------------|
| `geo:catalog:plan -w @radar/api` | dry-run шагов 1–2 (tabular + frontline) |
| `geo:catalog:import -w @radar/api` | полный import: tabular → frontline → osm → adjacency |
| `geo:catalog:reset -w @radar/api -- --confirm` | wipe только гео-справочника |
| `geo:db:apply -w @radar/api` | legacy: tabular + frontline без osm/adjacency |
| `geo:features:import -w @radar/api` | legacy: только osm_geometry (нужны places в БД) |

**Артефакты на диске** (fallback путей):

```
data/geo/catalog/regions.json
data/geo/catalog/03_all_cities.xlsx      # обязателен для ~128k НП
data/geo/dictionaries/places.json        # frontline override
data/geo/artifacts/boundaries/...      # OSM geometry
data/geo/dictionaries/adjacency.json   # смежность
```

---

## Диагностика перед/после

```powershell
# dry-run без SQL
npm run parse-engine:system:wipe -w @radar/worker -- --dry-run
npm run geo:catalog:reset -w @radar/api -- --dry-run

# очереди
npm run parse-engine:status -w @radar/worker
npm run parse-engine:queue:ingest -w @radar/worker
npm run parse-engine:queue:geo -w @radar/worker
```

---

## Что никогда не удаляется wipe-командами

`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `status_dictionary`, `.env`, Telegram session, файлы `data/geo/` на диске.

---

## См. также

- [shpargalka-operacii.md](../shpargalka-operacii.md) — общая шпаргалка dev/parse/ingest
- [phase-commands.md](../phase-commands.md) — семантика wipe/reset/clear по фазам
- [adr-005-geo-feature-layer.md](../adr-005-geo-feature-layer.md) — geo_feature и OSM
- [data/geo/README.md](../../data/geo/README.md) — структура артефактов
