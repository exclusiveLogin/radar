# Шпаргалка: команды radar

PowerShell, корень репо. Нужны `DATABASE_URL`, `RADAR_STORAGE_MODE=db`, запущенный Postgres.

**Единая точка входа:** [`radar-cli.md`](./radar-cli.md) — `npm run radar -- <domain> <action>`

> 📌 **Ingest · backfill · parse · UI · диагностика:** [cheatsheet.md](./cheatsheet.md)  
> 📌 **Полный сброс + переливка каталога + reparse:** [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md)

---

## radar CLI (предпочтительно)

```powershell
npm run radar -- help
npm run radar -- stack cold-up              # первый раз
npm run radar -- stack dev --full           # UI+API+worker
npm run radar -- stack dev                  # UI+API без worker
npm run radar -- stack migrate
npm run radar -- pipeline status
npm run radar -- pipeline reset             # parsed сброс, raw остаётся
npm run radar -- pipeline clear
npm run radar -- phase wipe vendor-ingest-parse-geo -- --confirm
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run
```

Legacy-алиасы — [`radar-cli.md`](./radar-cli.md) (единая таблица по доменам).

---

## Запуск dev-стека

```
npm run radar -- stack dev --full    # shared + api + web + worker
npm run radar -- stack dev           # только shared + api + web
```

- Первый старт: **~40–90 с** (predev собирает все пакеты)
- Worker стартует после `/api/ready` — не закрывай терминал раньше
- Ошибка «API dist не найден»: api ещё не собрался; перезапусти `npm run radar -- stack dev --full`

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
  fold snapshot         ← read-line (event_locations → foldMapState)
```

**Geo-каталог (staging, не runtime parse):**

```
npm run radar -- geo catalog:import
  tabular → frontline → osm_geometry → adjacency
```

Подробно: [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md)

**Таблицы radar ↔ legacy:** [`radar-cli.md`](./radar-cli.md) — единый справочник по доменам.

---

## Что никогда не удаляется wipe-командами

`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `.env`, Telegram session

---

## Семантика wipe / reset / clear

Подробно: [phase-commands.md](./phase-commands.md). Таблицы команд: [radar-cli.md](./radar-cli.md).

---

## Сценарии

> Полные сценарии (wipe → catalog → backfill → rebuild): **[runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md)**

### Быстро: чистая система

```powershell
npm run radar -- phase wipe vendor-ingest-parse-geo -- --confirm
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run
```

### Перепарсить raw без смены каталога

```powershell
npm run radar -- pipeline reset
npm run radar -- parse run
```

### Сбросить только очереди (не удалять данные)

```powershell
npm run radar -- phase clear all -- --dry-run
npm run radar -- phase clear all
```

### Накатить миграции после pull

```powershell
npm run radar -- stack migrate
npm run radar -- stack dev --full
```

---

## REST API — шпаргалка (base: http://127.0.0.1:3000)

> Swagger UI: http://127.0.0.1:3000/api/docs

### Карта (read-side)

| Метод | Путь | Параметры | Что возвращает |
|-------|------|-----------|----------------|
| GET | `/map/snapshot` | `?asOf=ISO8601` (Time Machine), `?since=` (опц.) | Fold snapshot: регионы, places, warnings |
| GET | `/map/events/heatmap` | `?period=24h\|7d\|30d\|all`, `?eventTypes=`, `?until=ISO`, `?limit=` | GeoJSON точек + meta (count, since/until) |
| GET | `/map/regions-geojson` | — | GeoJSON FeatureCollection полигонов регионов (включая grey) |
| GET | `/map/districts-active-geojson` | — | GeoJSON активных районов (только `action=raise`); лёгкий, вызывать при каждом place-state |
| GET | `/map/districts-geojson` | `?regionId=UUID` (опц.) | GeoJSON всех районов; тяжёлый — для ленивой подгрузки по региону |
| GET | `/map/messages/recent` | `?limit=80` | Все raw (1 строка/raw): `contentKind`, parse/loc summary |
| GET | `/map/events/recent` | `?limit=80` | События с `event_locations` (1 parsed_event = 1 карточка), без фильтра по типу |
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
