# Шпаргалка: команды radar

PowerShell, корень репо. Нужны `DATABASE_URL`, `RADAR_STORAGE_MODE=db`, запущенный Postgres.

---

## Запуск dev-стека

```
npm run dev          # shared + api + web + worker (полный)
npm run dev:app      # только shared + api + web (без worker)
```

- Первый старт: **~40–90 с** (predev собирает все пакеты)
- Worker стартует после `/api/ready` — не закрывай терминал раньше
- Ошибка «API dist не найден»: api ещё не собрался; перезапусти `npm run dev`

| URL | |
|-----|---|
| UI | http://localhost:5173 |
| API | http://127.0.0.1:3000 |
| Worker probe | http://127.0.0.1:3010/status |

---

## Пайплайн данных

```
[Telegram / backfill]
        │
        ▼
  raw_messages          ← ingest (каналы)
        │
        ▼
  phase_coverage        ← очередь ingest-parse
        │
        ▼
  parsed_events         ← parse (catalog eager + llm + dadata)
  event_locations
        │
        ▼
  place_enrichment_jobs ← geo (обогащение координат)
        │
        ▼
  places.centroid_*     ← geo-обогащённые места
  region_status_read_model
  place_status_read_model  ← read-model карты
```

**Geo-каталог (структурные данные, не runtime):**

```
data/geo/catalog/regions.json  →  regions + places(kind=region)
data/geo/artifacts/...GeoJSON  →  geo_feature + places(kind=district/...)
```

---

## Таблица ключевых команд

### Запуск и сборка

| Команда | Что делает |
|---------|-----------|
| `npm run dev` | Полный dev: shared+api+web+worker |
| `npm run dev:app` | Без worker |
| `npm run build` | Собрать все пакеты |
| `npm run migration:run` | Применить новые миграции БД |
| `npm run up` | `docker compose up -d` + `dev:app` |
| `npm run cold:up` | Поднять docker + применить миграции + `dev:app` |

### Ingest — загрузка raw-сообщений

| Команда | Что делает |
|---------|-----------|
| `npm run ingest:run -- --channels=<key>` | backfill канала (грузит старые сообщения) |
| `npm run ingest:wipe` | Удалить raw + parsed + evloc + очереди + read-model. **Places/regions не трогает** |
| `npm run ingest:reset` | noop (нечего сбрасывать) |

### Parse — разбор сообщений → события

| Команда | Что делает |
|---------|-----------|
| `npm run parse:run` | Перепарсить все raw (rebuild + drain) |
| `npm run parse:wipe [-- --dry-run]` | Удалить parsed_events + evloc + read-model. **Raw остаётся** |
| `npm run parse:reset` | noop |
| `npm run parse-engine:rebuild` | Заново заполнить phase_coverage по всем raw (без drain) |
| `npm run parse-engine:drain` | Догнать очереди (нужен worker) |
| `npm run parse-engine:rebuild:drain` | rebuild + drain за один раз |
| `npm run parse-engine:status` | Статус фаз (enabled/disabled, backlog) |
| `npm run parse-engine:queue:ingest` | Очередь ingest-parse (pending/failed) |
| `npm run parse-engine:queue:geo` | Очередь geo (pending/failed) |

### Geo-каталог — структурные данные (регионы, контуры)

| Команда | Что делает |
|---------|-----------|
| `npm run geo:init` | Полная инициализация с нуля: regions:seed → vendor → sync → seed → features:import |
| `npm run geo:regions:seed` | Записать регионы из `data/geo/catalog/regions.json` → `regions` + `places(kind=region)` |
| `npm run geo:features:import` | OSM GeoJSON → `geo_feature` + catalog `places` (district/city_district) + `place_geo_link` |
| `npm run geo:vendor` | Скачать/клонировать OSM GeoJSON (data/geo/vendor) |
| `npm run geo:sync` | Синхронизировать артефакты из vendor в data/geo/artifacts |
| `npm run geo:seed` | Записать реестр `geo_dataset_file` (трекинг импорта) |
| `npm run geo:update` | Обновить vendor + пересинк + re-import features |
| `npm run vendor:wipe` | Удалить data/geo/artifacts + data/geo/vendor (диск, не БД) |
| `npm run vendor:run` | `geo:vendor` + `geo:sync` |

### Geo-обогащение мест (координаты)

| Команда | Что делает |
|---------|-----------|
| `npm run geo:run` | `geo:regions:seed` + `geo:features:import` |
| `npm run geo:reset [-- --dry-run]` | Обнулить centroid/bbox/trust у places; очистить jobs/evidence |
| `npm run geo:wipe [-- --dry-run]` | Удалить все places + aliases. **geo_feature/regions остаются** |
| `npm run geo-catalog:wipe [-- --dry-run]` | Удалить regions + geo_feature + place_geo_link |
| `npm run parse-engine:geo:drain` | Прогнать geo-обогащение сейчас |
| `npm run parse-engine:geo:check` | Проверить состояние geo-очереди |
| `npm run parse-engine:geo:recover` | Разблокировать зависшие geo-jobs (processing → pending) |

### Составные wipe-операции

| Команда | Что удаляет |
|---------|------------|
| `npm run ingest-parse:wipe [-- --dry-run]` | raw + parsed + evloc + очереди + read-model |
| `npm run vendor-ingest-parse-geo:wipe [-- --dry-run]` | всё выше + places + geo_feature + regions |
| `npm run system:reset -- --confirm` | vendor:wipe + vendor-ingest-parse-geo:wipe + geo:init |
| `npm run system:reset -- --confirm --wipe-only` | только wipe, без geo:init |

### Очистить только очереди (без удаления данных)

| Команда | Что очищает |
|---------|------------|
| `npm run phase:ingest:clear [-- --dry-run]` | `phase_coverage` + cancel phase_runs (ingest) |
| `npm run phase:geo:clear [-- --dry-run]` | `place_enrichment_jobs` + cancel phase_runs (geo) |
| `npm run phase:all:clear [-- --dry-run]` | обе очереди |

### Отладка parse

| Команда | Что делает |
|---------|-----------|
| `npm run worker:parse:snap -- "<текст>"` | Разобрать одно сообщение (catalog + llm) |
| `npm run worker:parse:snap:ollama -- "<текст>"` | То же, только через ollama |
| `npm run worker:parse:report -- --limit=20` | Последние разборы с решениями |
| `npm run parse-engine:catalog:heal` | Heal catalog places (обогатить через dadata) |

### Ingest manifest / backfill

| Команда | Что делает |
|---------|-----------|
| `npm run ingest:manifest:import` | Загрузить каналы из файла в БД |
| `npm run ingest:manifest:export` | Экспортировать каналы в файл |

---

## Что никогда не удаляется wipe-командами

`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `.env`, Telegram session

---

## Семантика wipe / reset / clear

```
wipe  — удалить весь контент фазы (до чистого состояния)
reset — снять только обогащение (координаты, trust, jobs), строки остаются
clear — только очереди (phase_coverage / place_enrichment_jobs), cancel runs
run   — раскатить фазу заново (без удаления)
```

Все мутирующие команды поддерживают **`-- --dry-run`** — покажут что будет удалено.

---

## Сценарии

### Полный сброс и накатка гео

```powershell
# Остановить dev (Ctrl+C)
npm run system:reset -- --confirm
# После: опционально перепарсить raw
npm run parse:run
```

### Перепарсить все raw без сброса гео-каталога

```powershell
# Остановить worker если крутится
npm run parse:wipe
npm run parse:run
```

### Обновить гео-данные (новые границы районов)

```powershell
npm run geo:update          # vendor → sync → re-import features
```

### Сбросить только очереди (не удалять данные)

```powershell
npm run phase:all:clear -- --dry-run   # проверить
npm run phase:all:clear
```

### Накатить миграции после pull

```powershell
npm run migration:run
npm run dev
```

---

## REST API — шпаргалка (base: http://127.0.0.1:3000)

> Swagger UI: http://127.0.0.1:3000/api-docs

### Карта (read-side)

| Метод | Путь | Параметры | Что возвращает |
|-------|------|-----------|----------------|
| GET | `/map/snapshot` | `?since=ISO8601` (опц.) | Полный снапшот: регионы, places, предупреждения, layout-тайлы схемы |
| GET | `/map/regions-geojson` | — | GeoJSON FeatureCollection полигонов регионов (включая grey) |
| GET | `/map/districts-active-geojson` | — | GeoJSON активных районов (только `action=raise`); лёгкий, вызывать при каждом place-state |
| GET | `/map/districts-geojson` | `?regionId=UUID` (опц.) | GeoJSON всех районов; тяжёлый — для ленивой подгрузки по региону |
| GET | `/map/messages/recent` | `?limit=80` | Лента raw-сообщений (все каналы) |
| GET | `/map/events/recent` | `?limit=80` | Лента событий изменения статуса (1 событие = 1 карточка) |
| GET | `/map/regions/by-code/:code/source-message` | `code` = ISO 3166-2:RU (напр. `RU-MOW`) | Исходное сообщение статуса региона |
| GET | `/map/places/:placeId/source-message` | `placeId` = UUID | Исходное сообщение статуса НП |
| POST | `/map/push-snapshot` | — | Разослать снапшот всем WS-клиентам; `{ ok, pushed }` |

### Регионы и места

| Метод | Путь | Параметры | Что возвращает |
|-------|------|-----------|----------------|
| GET | `/geo/regions` | — | Справочник регионов (regionId, code, name, centroid, bbox) — без геометрии |
| GET | `/regions/:id/geometry` | `id` = regionId UUID | Геометрия региона (bbox, geometryArtifactKey) для ленивой подгрузки |
| GET | `/places` | `?regionId=UUID`, `?limit=1000` | Список places с координатами центроида |
| GET | `/status-dictionary` | — | Словарь уровней (`stateLevel → label, color`) |

### Предупреждения

| Метод | Путь | Параметры | Что возвращает |
|-------|------|-----------|----------------|
| GET | `/warnings` | `?since=ISO8601`, `?limit=100` | Все предупреждения (cursor-пагинация) |
| GET | `/regions/:id/warnings` | `?since=ISO8601`, `?limit=100` | Предупреждения одного региона |

### WebSocket (`ws://127.0.0.1:3000/map`)

Сообщения сервера (входящие на клиент):

| Тип | Когда | Ключевые поля |
|-----|-------|---------------|
| `map-snapshot` | На подключение + после фаз | `regions[]`, `places[]`, `warnings[]`, `layout` |
| `region-state` | При смене статуса региона | `regionCode`, `stateLevel`, `statusEventAt`, `layout.col/row` |
| `place-state` | При смене статуса НП | `placeId`, `regionCode`, `stateLevel`, `action`, `lat`, `lon`, `geoFeatureId`, `kind` |
| `warning` | При новом предупреждении | `regionCode`, `text`, `level`, `occurredAt` |

**`stateLevel` значения:** `grey` (нет данных / истёк TTL) → `green` → `yellow` → `orange` → `red`

**Правила каскадирования (бэкенд):**
- Новый статус региона → дочерние places с более старым `statusEventAt` подавляются (не отображаются).
- TTL 24 ч (по умолчанию): регион помечается `stale=true`, WS шлёт `stateLevel: grey` → фронт убирает.
- Вместе с регионом гасятся его дочерние places.

---

## Env (минимум)

```env
DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
RADAR_STORAGE_MODE=db
```

Опционально: `DADATA_TOKEN`, `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`, Ollama для LLM, `RADAR_VERBOSE_GEO_LOG=1` (подробный лог geo в worker).
