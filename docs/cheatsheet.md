# Шпаргалка Radar (операции)

Краткий справочник команд и типовых сценариев. PowerShell, корень репо.

| Документ | Когда |
|----------|--------|
| [getting-started.md](./getting-started.md) | первый запуск, troubleshooting |
| [shpargalka-operacii.md](./shpargalka-operacii.md) | **wipe/reset/clear**, geo-каталог, REST API, сценарии сброса |
| [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md) | чистый перезапуск: wipe → catalog → backfill → reparse |
| [ingest-providers.md](./ingest-providers.md) | Telegram session, manifest, CLI ingest |
| [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) | демон полной истории |

**Минимум `.env`:**

```env
DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
RADAR_STORAGE_MODE=db
RADAR_SESSIONS_DIR=.radar/sessions
```

---

## Запуск

| Цель | Команда |
|------|---------|
| Первый раз | `Copy-Item .env.example .env` → `npm run cold:up` |
| UI + API (без Telegram) | `npm run up` |
| Полный стек + worker | `npm run dev` |
| Только UI + API | `npm run dev:app` |
| Миграции после pull | `npm run migration:run` |

**Проверка:**

| URL | Ожидание |
|-----|----------|
| http://127.0.0.1:3000/api/ready | `"status":"ready"` |
| http://127.0.0.1:5173 | OSINT-дашборд |
| http://127.0.0.1:3000/api/docs | Swagger |
| http://127.0.0.1:3000/api/worker/status | probe worker |
| http://127.0.0.1:3010/status | worker HTTP probe |

```powershell
node scripts/ws-smoke.mjs
curl.exe -s http://127.0.0.1:3000/api/map/snapshot | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('regions',j.regions?.length,'places',j.places?.length)})"
curl.exe -s "http://127.0.0.1:3000/api/map/events/heatmap?period=7d" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('heatmap',j.meta?.count)})"
curl.exe -s "http://127.0.0.1:3000/api/map/snapshot?asOf=2026-06-14T12:00:00.000Z" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('historical ok'))"
```

---

## Ingest: от нуля до live

### 1. Telegram-сессия

```powershell
npm run worker:session:deploy
npm run worker:session:probe
```

Слот по умолчанию: `tg-default-user` → `.radar/sessions/tg-default-user/`.

### 2. Каналы в PostgreSQL

```powershell
npm run ingest:manifest:import
```

**Bootstrap:** если `.radar/ingest.manifest.json` нет — CLI **сам создаёт** его из bundled-шаблона `docs/examples/ingest.manifest.radar-channels-mtproxy.json`.

**Каналы по умолчанию (4 шт.):**

| key | Telegram | title |
|-----|----------|-------|
| `radar-pf` | `@Radarpf` | Radar PF |
| `radar-russia` | `@radarrussiia` | Radar Russia |
| `radar-rvk` | `@radar_rvk` | Radar RVK |
| `radar-rrpfo` | `@RRPFO` | RRPFO |

Свой manifest: положить JSON в `.radar/ingest.manifest.json` или задать `RADAR_INGEST_MANIFEST`.

После import активировать provider (если `draft`):

```http
POST /api/admin/ingest/providers/{id}/start
```

### 3. Worker

```powershell
npm run worker:dev
```

В логах: `Режим хранилища worker: db`, `Запуск IngestOrchestrator`, `BackfillDaemon запущен`.

---

## Backfill (архив сообщений)

### CLI — разовая пачка (без job в БД)

**Все enabled каналы, по 100 сообщений:**

```powershell
npm run worker:ingest:backfill -- --all-bindings --batch-size=100
```

**Один канал** (UUID из SQL ниже):

```powershell
npm run worker:ingest:backfill -- `
  --provider-id="<uuid>" `
  --binding-id="<uuid>" `
  --batch-size=100
```

| Флаг | Назначение |
|------|------------|
| `--all-bindings` | Все enabled bindings подряд |
| `--batch-size=N` | Сообщений за один проход (default 200) |
| `--from-posted-at` / `--to-posted-at` | Фильтр по дате (ISO UTC) |

**Выход:** `Backfill chunk: { inserted, duplicates }` или `Backfill all: { bindings, inserted, duplicates }`.

**Инварианты:** live-cursor не двигается; дубликаты идемпотентны; каждое новое сообщение проходит parse.

### Backfill V2 — демон (полная история)

1. Worker в `db` mode, `BackfillDaemon` включён.
2. `POST /api/admin/ingest/backfill-jobs` с `bindingId` + `strategy: "all"`.
3. Статус: `ingest_backfill_jobs.status` → `pending` → `running` → `completed`.

Подробно: [backfill-v2-pipeline.md](./backfill-v2-pipeline.md).

---

## Полезный SQL

**Bindings + provider id:**

```sql
SELECT p.id AS provider_id, b.id AS binding_id, b.binding_key, c.key AS channel_key
FROM ingest_bindings b
JOIN ingest_providers p ON p.id = b.provider_id
LEFT JOIN channels c ON c.id = b.channel_id
WHERE b.enabled = true;
```

**Сырые сообщения backfill:**

```sql
SELECT ch.key, count(*) FROM raw_messages rm
JOIN channels ch ON ch.id = rm.channel_id
WHERE rm.ingest_mode = 'backfill'
GROUP BY ch.key;
```

**Последние raw по каналу:**

```sql
SELECT rm.posted_at, rm.ingest_mode, left(rm.raw_text, 120)
FROM raw_messages rm
JOIN channels ch ON ch.id = rm.channel_id
WHERE ch.key = 'radar-rrpfo'
ORDER BY rm.posted_at DESC LIMIT 10;
```

---

## Parse engine

**Высокий уровень** — сценарии «что сделать с данными»:

| Задача | Команда |
|--------|---------|
| Первый прогон parse-engine (манифест фаз + reparse raw) | `npm run parse-engine:init` |
| Пересчёт из raw (eager catalog) | `npm run parse-engine:rebuild` |
| Reparse + drain scheduled | `npm run parse-engine:rebuild:drain` |
| Догнать все очереди (ingest + geo) | `npm run parse-engine:drain` |
| Сводка очередей и активных runs | `npm run parse-engine:status` |
| Сброс parsed (raw сохранить) | `npm run parse-engine:reset` |
| Полный сброс контента (конфиг остаётся) | `npm run parse-engine:clear` |
| Удалить только raw | `npm run parse-engine:clear:raw` |
| Сброс ingest (курсоры, backfill) | `npm run parse-engine:clear:ingest` |

**Низкий уровень** — drain, backfill, одна фаза:

| Задача | Команда |
|--------|---------|
| Очередь ingest (phase_coverage) | `npm run parse-engine:queue:ingest` |
| Очередь geo (place_enrichment_jobs) | `npm run parse-engine:queue:geo` |
| Активные phase_runs | `npm run parse-engine:runs:status` |
| Drain scheduled ingest | `npm run parse-engine:ingest:drain` [`--phase=id`] |
| Drain scheduled geo | `npm run parse-engine:geo:drain` [`--phase=id`] |
| Ingest backfill | `npm run parse-engine:ingest:backfill` |
| Ручной прогон фазы | `npm run parse-engine:phase:run -- --phase=llm` |
| Стоп runs + очистка coverage | `npm run parse-engine:phase:stop` |
| Импорт/экспорт манифеста фаз | `npm run phase:manifest:import` / `export` |

**Wipe / reset / clear** (семантика, dry-run, составные команды): [shpargalka-operacii.md](./shpargalka-operacii.md).

---

## Geo-каталог

| Задача | Команда |
|--------|---------|
| **Основной import** (tabular → frontline → osm → adjacency) | `npm run geo:catalog:import -w @radar/api` |
| Dry-run шагов | `npm run geo:catalog:plan -w @radar/api` |
| Wipe справочника | `npm run geo:catalog:reset -w @radar/api -- --confirm` |
| Layout схемы (89 субъектов) | `npm run geo:layout:build` |

**Legacy pipeline** (artifacts): `geo:vendor` → `geo:sync` → `geo:seed` → `geo:db:apply` — см. [data/geo/README.md](../data/geo/README.md).

**Geo-обогащение places:** `parse-engine:geo:drain`, `geo:check`, `geo:recover`, `parse-engine:catalog:heal`.

---

## Карта и parse (лаборатория)

| Задача | Команда |
|--------|---------|
| Диагностика read-line fold | `npm run map:fold:status` |
| Оффлайн batch-отчёт | `npm run worker:parse:report -- --input tests --outdir reports` |
| Snap одного текста | `npm run worker:parse:snap -- tests/snap_001.txt` |
| Snap + LLM (Ollama) | `npm run worker:parse:snap:ollama -- --input tests/snap_001.txt` |
| Batch-отчёт + сводка | `npm run worker:parse:report -- --input tests --outdir reports` |

**TTL карты:** `RADAR_MAP_STATE_TTL_HOURS` / `RADAR_MAP_STATE_TTL_MS` (default 24 ч) — на **read-line fold** (`foldMapState`); факты старше окна не участвуют. Legacy `worker:map-state:expire` и projection daemon **удалены**.

**REST (read-side):**

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/api/map/snapshot` | fold snapshot (live) |
| GET | `/api/map/snapshot?asOf=ISO` | Time Machine / REPLAY |
| GET | `/api/map/events/heatmap` | `period=24h\|7d\|30d\|all`, `eventTypes=`, `until=` |
| GET | `/api/map/regions-geojson` | контуры субъектов |
| GET | `/api/map/districts-active-geojson` | активные районы |
| WS | `/ws` | `snapshot`, `region-state`, `place-state`, `warning` |

Полная REST-таблица: [shpargalka-operacii.md § REST](./shpargalka-operacii.md#rest-api--шпаргалка-base-http1270013000).

---

## Async-обогащение (фазы, ADR-003)

**Phase-pipeline v2:** фазы `catalog|llm|dadata|nominatim`, очередь `phase_coverage`, оркестратор `PhaseRunner` + `IngestParseDaemon`. Подробно: [phase-pipeline.md](./phase-pipeline.md).

```powershell
npm run migration:run
npm run phase:manifest:import
npm run phase:manifest:export
```

**DaData:** в корневом `.env` задать `DADATA_TOKEN=` (ключ с [dadata.ru](https://dadata.ru/profile/#info)).
Порядок шагов: `RADAR_GEO_PIPELINE_ORDER=catalog,dadata,llm,nominatim`.

| trigger | Поведение |
|---------|-----------|
| `eager` | После ingest/reparse — inline catalog (по `order`) |
| `scheduled` | IngestParseDaemon, `intervalMs`, batch из coverage |
| `manual` | `parse-engine:phase:run`, админка Run |

После **completed** phase_run worker дергает `POST /api/map/push-snapshot` (`RADAR_MAP_SNAPSHOT_AFTER_PHASE=1`, по умолчанию вкл.).

```powershell
npm run parse-engine:phase:run -- --phase=llm --batch=100 [--watch]
npm run parse-engine:rebuild
```

**Прогресс:** `GET /api/admin/phases/runs/overview`, виджет «Фазы».

**Env:** `RADAR_STORAGE_MODE=db`, `RADAR_PHASE_DAEMON_ENABLED` (scheduled), `RADAR_LLM_*`.

Статус: [phase-pipeline-status.md](./phase-pipeline-status.md) · админка: [api/phases-admin.md](./api/phases-admin.md).

---

## Web UI (OSINT shell)

**Layout:** карта фоном, glass-рейлы, header (UTC, LiveBadge, тема, ⚙ виджеты). Поверх карты — **панель «Слои»**, внизу — **таймлайн** (если слой вкл.).

**Правый рейл** — панели **свёрнуты по умолчанию**.

| Виджет | Зона | Данные |
|--------|------|--------|
| Гео-карта | фон | MapLibre + WS + слои |
| Обзор (KPI + donut) | left | `regionsByCode$` |
| Схема | left | `layout.json` — `npm run geo:layout:build` |
| Активные угрозы | right | active region/place |
| Лента изменений | right | recent events |
| Сообщения | right | `GET /api/map/messages/recent` |
| Macro-сводки | right | `GET /api/map/pvo-reports` (→ D6: `/map/event-feed`) |
| Топ активности | right | top regions |
| Динамика | right | sparkline |
| Каналы / Система | right | providers + health |

**Слои карты:** регионы · районы · места · **теплокарта** (period, eventTypes) · **таймлайн** (LIVE/REPLAY).

**Лента системных событий** (`AppLogOverlay`, `appLogStore`): правый нижний угол, toast-стек info/warn/error — загрузка и ошибки fetch по карте/виджетам, reconnect WS. Env: `VITE_APP_LOG_LEVEL=info|warn|error` (default `warn`).

**Realtime:** `GET /api/map/snapshot` → WS `/ws`. В REPLAY — `?asOf=`, WS не применяется.

---

## Диагностика

| Симптом | Действие |
|---------|----------|
| Ingest не в БД | `RADAR_STORAGE_MODE=db`, перезапуск worker |
| Нет каналов | `npm run ingest:manifest:import`, provider `active` |
| Backfill pending | worker db + `BackfillDaemon запущен` |
| Карта пустая после ingest | `npm run parse-engine:rebuild:drain` |
| Heatmap пустая | есть `event_locations` с координатами; проверить `period` / `eventTypes` |
| API_ID_INVALID | свои `TELEGRAM_API_ID/HASH` с my.telegram.org |
| `[api] EBUSY` при `npm run dev` | stop node → удалить `packages/api/dist` → `npm run dev:app` |
| CLI прогресс «листает» строки | `RADAR_VERBOSE_PARSE_LOG=1` → stderr |

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force packages\api\dist -ErrorAction SilentlyContinue
npm run dev:app

node scripts/query-ingest-status.mjs
```

**CLI с live-progress:** `parse-engine:rebuild`, `parse-engine:phase:run`, `parse-engine:ingest:backfill` — да. `parse-engine:reset` — нет.

---

## Manifest export / import

```powershell
npm run ingest:manifest:export   # БД → .radar/ingest.manifest.json
npm run ingest:manifest:import   # JSON → БД (upsert channels)
```

---

## Типовые сценарии

```powershell
# Чистая система (кратко — полный runbook в geo-clean-rebuild.md)
npm run parse-engine:system:wipe -- --confirm
npm run geo:catalog:import -w @radar/api
npm run parse-engine:ingest:backfill -- --all-bindings --batch-size=100
npm run parse-engine:rebuild:drain

# Перепарсить raw без смены каталога
npm run parse-engine:reset
npm run parse:run

# Сбросить только очереди
npm run phase:all:clear -- --dry-run
npm run phase:all:clear
```

Подробнее: [shpargalka-operacii.md § Сценарии](./shpargalka-operacii.md#сценарии).
