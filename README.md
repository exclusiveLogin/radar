# Radar

**OSINT-платформа оперативной обстановки** по сигналам **БПЛА** и ракетных угроз: хаотичные Telegram-каналы → структурированные события → геопроекция → **live-карта** и интерфейс принятия решений.

Не BI и не «ещё один чат-агрегатор». Это **Common Operational Picture (COP)** для текстового шума: ingest, parse, trust-aware geo, липкий автомат статусов, WebSocket-дельты и glass-дашборд поверх MapLibre. По духу — узкий slice **Palantir Gotham** / situational awareness, без enterprise-обвеса.

**Запуск локально:** [docs/getting-started.md](docs/getting-started.md) · **Шпаргалка:** [docs/cheatsheet.md](docs/cheatsheet.md) · **Доки:** [docs/README.md](docs/README.md) · **План:** [docs/plan.md](docs/plan.md) · **Домен:** [docs/domain/README.md](docs/domain/README.md) · **Trust мест:** [docs/place-trust-explained.md](docs/place-trust-explained.md)

![Radar — OSINT-дашборд: гео-карта, KPI, схема, лента и системные виджеты](docs/assets/dashboard-osint-shell.png)

---

## Что это

| Измерение | Radar |
|-----------|--------|
| **Класс продукта** | OSINT / operational awareness / СППР-lite |
| **Вход** | Telegram (MTProto), ручной admin-ingest, backfill |
| **Ядро** | Parse pipeline + geo enrichers + region/place state projection |
| **Выход** | REST + WS, карта, KPI-виджеты, журнал смен, probe worker |
| **Не делает** | Не заменяет официальные оповещения; не юридическое «доказательство» |

**Миссия:** сократить путь от «увидел сообщение в канале» до «понял, где риск и как менялась обстановка» — в секунды, на одном экране.

---

## Для кого

| Аудитория | Ценность |
|-----------|----------|
| Граждане и локальные сообщества | Карта и лента по региону без ручного мониторинга десятков каналов |
| Мониторинговые команды | Единый COP, ingest-провайдеры, heartbeat worker |
| Аналитики | История `region_state_history`, срезы активности, batch parse reports |
| Разработка | Монорепо `worker → API → web`, воспроизводимые geo-артефакты, Zod-контракты |

---

## Конвейер данных

1. **Ingest** — GramJS live + poll fallback, backfill, dedup raw.
2. **Parse** — классификация события (угроза / отбой / шум), извлечение локаций.
3. **Geo** — artifacts-first, enrichers (`cache → dadata → nominatim → llm`), place trust.
4. **Projection** — `place_status_active` + `region_state_active` (липкий автомат + соседи).
5. **Delivery** — REST snapshot, WS `/ws`, поллеры history → UI.

> Сервис повышает **наблюдаемость** и скорость понимания картины; решения пользователь принимает сам.

---

## Сейчас в продукте

### Web — OSINT-оболочка

- **Layout:** карта фоном, glass-рейлы слева/справа, ломаный header (UTC-часы, **LiveBadge** = WS + API/БД). Правый рейл — панели **свёрнуты по умолчанию**.
- **Виджеты** (реестр `widgetRegistry`, toggles в ⚙):
  - **Гео-карта** — MapLibre, контуры субъектов (fill + inset outline), маркеры places.
  - **Схема** — layout.json, heat по `stateLevel`.
  - **Обзор** — KPI по уровням + donut.
  - **Активные угрозы**, **Лента изменений** — live feed из `region_state_history`.
  - **Сообщения** — лента raw ingest (канал, время MSK, parse status).
  - **Топ активности**, **Динамика событий** — sparkline + BarMini по журналу.
  - **Каналы**, **Система** — ingest providers, worker probe, WS/db health.
- **Realtime:** `mapStore` — snapshot + WS `region-state` | `place-state` | `warning`.
- **Тема:** light/dark (`data-theme`), design-system primitives, тонкие accent-скроллбары.

### Backend / worker

- NestJS API, Swagger `/api/docs`, PostgreSQL + TypeORM.
- WS gateway, region/place state pollers.
- Worker: parse pipeline, `RegionStateProjection`, outbox events.
- **Live ingest fixes:** `getPeerId` для GramJS, poll fallback, orchestrator recovery.
- **Worker probe:** HTTP `:3010/status`, REST `GET /api/worker/status`.
- **Map state:** TTL expiry daemon; каскадный сброс place при региональном отбое.
- Geo CLI: `vendor → sync → seed → db:apply`.

---

## Roadmap (ещё не в UI / в работе)

- ⏱️ Time Machine — scrub по срезам времени.
- 🎯 ETA / курс / траектория подлёта.
- 🔔 Push / геозонные алерты.
- 🔥 Heatmap накопительная по периодам.
- 🧾 Архив с полнотext search и карточкой события.
- 📊 Расширенная аналитика и экспорт срезов.

---

## Архитектура (упрощённо)

```mermaid
flowchart LR
  subgraph src[Источники]
    TG[Telegram]
  end

  subgraph worker[Worker]
    ING[Ingest MTProto]
    PAR[Parse + Geo]
    PRJ[State projection]
  end

  subgraph data[PostgreSQL]
    RAW[raw_messages]
    ST[state_active + history]
    GEO[(places / regions)]
  end

  subgraph api[NestJS]
    REST[REST / Swagger]
    WS[WebSocket /ws]
    PROBE[worker status]
  end

  subgraph ui[Web — OSINT shell]
    MAP[Geo + schematic]
    KPI[KPI / trend widgets]
    FEED[State changes feed]
  end

  TG --> ING --> RAW
  RAW --> PAR --> PRJ --> ST
  GEO --> PAR
  ST --> REST
  ST --> WS
  REST --> ui
  WS --> ui
  PROBE --> REST
```

### Макет UI

Скриншот актуального shell — в шапке README. Схема зон:

```
header: UTC · LiveBadge · theme · widget toggles
left rail:   Обзор (KPI + donut) · Схема          [развёрнуты]
background:  Гео-карта (MapLibre)
right rail:  Угрозы · Лента · Сообщения · Топ · Динамика · Каналы · Система  [свёрнуты по умолчанию]
```

---

## Шпаргалка (операции)

Полная версия: **[docs/cheatsheet.md](docs/cheatsheet.md)**.

### Запуск

| Команда | Что |
|---------|-----|
| `npm run cold:up` | Docker + install + migrations (первый раз) |
| `npm run up` | Docker + API + web |
| `npm run dev` | API + web + worker (БД уже есть) |

### Ingest (Telegram → БД)

```powershell
npm run worker:session:deploy
npm run worker:session:probe
npm run ingest:manifest:import    # bootstrap manifest если нет .radar/ingest.manifest.json
npm run worker:dev                # RADAR_STORAGE_MODE=db в .env
```

**Каналы по умолчанию:** `@Radarpf`, `@radarrussiia`, `@radar_rvk`, `@RRPFO` — шаблон `docs/examples/ingest.manifest.radar-channels-mtproxy.json`.

### Backfill (архив, CLI)

```powershell
# все enabled каналы, по 100 сообщений
npm run worker:ingest:backfill -- --all-bindings --batch-size=100

# один канал
npm run worker:ingest:backfill -- --provider-id=<uuid> --binding-id=<uuid> --batch-size=100
```

UUID bindings: SQL в [cheatsheet § SQL](docs/cheatsheet.md#полезный-sql). Полная история — Backfill V2: [backfill-v2-pipeline.md](docs/backfill-v2-pipeline.md).

### Phase-pipeline v2 (обогащение)

| Команда | Назначение |
|---------|------------|
| `npm run migration:run` | миграции БД (в т.ч. `phase_coverage`, `phase_runs`) |
| `npm run phase:manifest:import` | манифест фаз → `phase_definitions` |
| `npm run worker:dev` | ingest + IngestParseDaemon + GeoParseDaemon (scheduled) |
| `npm run parse-engine:phase:run -- --phase=llm` | ручной прогон фазы |
| `npm run parse-engine:rebuild` | invalidate parsed + coverage, ingest-поток (eager) |

Документация: [docs/phase-pipeline.md](./docs/phase-pipeline.md) · [cheatsheet](./docs/cheatsheet.md) · [статус внедрения](./docs/phase-pipeline-status.md).

### Карта / parse (лаборатория)

| Команда | Назначение |
|---------|------------|
| `npm run worker:map-state:expire` | TTL-sweep статусов |
| `npm run parse:snap` / `parse:report` | офлайн-проверка парсера (вне phase pipeline) |
| `npm run parse:ab -- --input tests` | A/B catalog vs llm |
| `node scripts/ws-smoke.mjs` | WebSocket |
| `node scripts/query-ingest-status.mjs` | ingest status |

ADR: [docs/adr-003-phase-enrichment-accumulator.md](./docs/adr-003-phase-enrichment-accumulator.md).

---

## CQRS + Domain Events

- Write-side публикует доменные события в outbox `domain_events`.
- Read-side отдает агрегированные данные через `api/events`, `api/regions`, `api/admin/*`.
- `OutboxRelay` доставляет новые события во внутренний `InProcessEventBus`.
- В воркере подключены встроенные подписчики `ParseAttemptLogger` и `MetricsAggregator`.
- Для телеметрии и админ-операций добавлен HLD-каркас `packages/admin-bot`.

### Runtime geo enrichment (актуальный контур)

- `raw` сначала проходит классификацию (`noise/meta/event`).
- Если это event: берется базовый регион из локальных артефактов/словаря.
- Далее запускается цепочка enrichers (`cache -> dadata -> nominatim -> llm`).
- Ответ провайдера матчится с каталогом (`fias -> alias -> name+region`).
- Если place найден: добавляется alias из сырого текста и дозаполняются missing-поля.
- Если place не найден, но валидация проходит: place создается и становится searchable для следующих сообщений.
- Для place хранится trust/provenance: `trust_state`, `is_trusted`, `trust_score`, `evidence_providers`.
- `place_evidence` хранит append-only историю подтверждений/кандидатов (`candidate|confirm|reject|enrich`) по провайдерам.
- `place_cache` хранит provider-aware техлог запросов и не заменяет основной каталог `places`.

### Place trust policy (runtime)

- `active` и `trusted` разделены: `active` — эксплуатационный флаг, `trusted` — уровень подтвержденности.
- Realtime правило:
  - `matched_existing` -> пишется evidence `confirm`, place обновляет trust-поля.
  - `created_new` -> пишется evidence `candidate`, trust остается на уровне policy-оценки источника.
- Базовые trust-score источников: `catalog=1.00`, `dadata=0.95`, `nominatim=0.80`, `llm=0.55`, `operator=1.00`, `system=0.70`.
- Для UI/read-side неподтвержденные места должны помечаться предупреждением (`needsAttention` в итерации 2).

## ⚙️ Статус репозитория

- **Монорепо:** `api`, `worker`, `web`, `shared` — cold start, dev-стек, TypeScript strict.
- **Web:** OSINT glass-shell, 9 виджетов, dual-theme DS, LiveBadge (WS + health).
- **Карта:** MapLibre + schematic layout; `region_state_active` / `place_status_active`; inset contours.
- **Realtime:** WS `/ws` — `snapshot`, `region-state`, `place-state`, `warning`; GeoJSON — `GET /api/map/regions-geojson`.
- **Worker:** live MTProto + poll, probe `:3010`, map-state TTL, cascade place clear on regional green.
- **Geo:** `vendor → artifacts → manifest → geo:seed → geo:db:apply`.
- **Ingest/parse:** db-mode, backfill V2, offline snapshots в `tests/`.

## Стек

- **Монорепозиторий:** npm workspaces — `packages/api`, `packages/worker`, `packages/web`, **`packages/shared`** (общие Zod-схемы и типы)
- **API:** NestJS, TypeORM, PostgreSQL, Swagger UI по адресу `/api/docs`
- **Adminer:** в Docker, см. [docker/adminer/README.md](docker/adminer/README.md) (порт по умолчанию **8080**)
- **pgAdmin:** в Docker, см. [docker/pgadmin/README.md](docker/pgadmin/README.md) (порт по умолчанию **5050**)
- **Worker:** GramJS (user MTProto), сессия в корне репозитория (см. ниже)
- **Web:** Vite + React; прокси **`/api`** и **`/ws`** → `http://127.0.0.1:3000`

## Запуск (Windows / PowerShell)

Полный сценарий (ingest, backfill, troubleshooting): **[docs/getting-started.md](docs/getting-started.md)**.

### Режимы одной строкой

| Команда | Docker (Postgres) | Процессы | Когда |
|---------|-------------------|----------|--------|
| **`npm run cold:up`** | да | install + build shared + **миграции** | первый раз на машине |
| **`npm run up`** | да | **shared + API + web** (`dev:app`) | каждый день, UI без Telegram |
| **`npm run dev`** | нет | shared + API + web + **worker** | БД уже поднята, полный стек |
| **`npm run dev:app`** | нет | shared + API + web | отладка карты/API без worker |

Перед `dev` / `dev:app` скрипты **`predev`** собирают `@radar/shared` и `@radar/api`. Web стартует **после** `http://127.0.0.1:3000/api/ready` (`scripts/dev-stack.mjs`).

### Первый запуск

```powershell
cd C:\path\to\radar
Copy-Item .env.example .env
# Минимум: DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
npm run cold:up
npm run dev:app
# или с worker и Telegram: npm run dev
```

Опции `cold:up` (можно комбинировать):

| Флаг | Эффект |
|------|--------|
| **`-Geo`** | `geo:vendor` → `geo:sync` → `geo:seed` → `geo:db:apply` (долго, нужен интернет) |
| **`-Dev`** | сразу запустить dev-стек после cold |
| **`-Llm`** | Docker profile `llm` + `ollama pull` |
| **`-LlmUi`** | + Open WebUI |

Пример: `npm run cold:up -- -Geo -Dev`

### Проверка после старта

| URL | Ожидание |
|-----|----------|
| [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health) | health без БД |
| [http://127.0.0.1:3000/api/ready](http://127.0.0.1:3000/api/ready) | `"status":"ready"` |
| [http://127.0.0.1:3000/api/docs](http://127.0.0.1:3000/api/docs) | Swagger |
| [http://127.0.0.1:5173](http://127.0.0.1:5173) | OSINT-дашборд (geo + KPI + feed) |
| [http://127.0.0.1:3000/api/worker/status](http://127.0.0.1:3000/api/worker/status) | probe worker (если поднят) |
| [http://127.0.0.1:8080](http://127.0.0.1:8080) | Adminer (PostgreSQL) |
| [http://127.0.0.1:5050](http://127.0.0.1:5050) | pgAdmin |

Проверка карты (PowerShell):

```powershell
curl.exe -s http://127.0.0.1:3000/api/map/snapshot | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('regions',j.regions?.length,'places',j.places?.length)})"
node scripts/ws-smoke.mjs
```

### Карта: REST + WebSocket

```text
Старт UI:  GET /api/map/snapshot  →  mapStore (регионы, places)
Подключение:  WS /ws  →  snapshot (повтор) + дельты
Live:  region-state | place-state | warning  →  патч store (не refetch snapshot)
Гео-контуры:  GET /api/map/regions-geojson  →  только активные субъекты (≠ grey)
```

| Слой UI | Источник данных |
|---------|-----------------|
| **Гео-карта / схема** | `regionsByCode$`, `placesById$` (snapshot + WS) |
| **KPI / donut / топ** | `regionsByCode$` (derivations) |
| **Лента / динамика / сообщения** | `stateChanges$`, `messagesFeed$` (REST + WS / poll) |
| **Каналы / система** | `providersStore` (REST poll 30s) + `connectionStatus$` (WS) |
| **LiveBadge** | WS open + `/api/health` + `/api/ready` |

Поллеры API читают `region_state_history` / `place_status_history` (раз в 1 с). События **до перезапуска API** по WS не переигрываются — только snapshot при connect.

Данные на карте после ingest: `npm run parse-engine:rebuild` (пересчёт проекций из `raw_messages`).

**TTL статусов (24 ч по умолчанию):** в `db`-режиме worker запускает `MapStateExpiryDaemon` — регионы с `state_level ≠ grey` и места в `place_status_active`, не обновлявшиеся дольше порога, сбрасываются (`grey` / `deactivate`) с записью в `*_history` → WS. Ручной прогон: `npm run worker:map-state:expire`. Env: `RADAR_MAP_STATE_TTL_HOURS`, `RADAR_MAP_STATE_EXPIRY_ENABLED`, `RADAR_MAP_STATE_EXPIRY_POLL_MS`.

### LLM (опционально)

```powershell
docker compose --profile llm up -d
docker compose --profile llm-ui up -d
```

- Ollama: [http://127.0.0.1:11434/api/tags](http://127.0.0.1:11434/api/tags)
- Open WebUI: [http://127.0.0.1:3001](http://127.0.0.1:3001) (`OPEN_WEBUI_PORT`)

---

### Пошагово вручную

1. **`.env.example` → `.env`** в корне (`DATABASE_URL` обязателен).
2. `docker compose up -d`
3. `npm install` → `npm run migration:run`
4. `npm run dev` или `npm run dev:app` (см. таблицу режимов выше).

Подробности transpile/watch: Nest + `shared/dist` для API; Vite тянет схемы из `packages/shared/src`.

## Локальные GeoJSON (без submodules)

См. [data/geo/README.md](data/geo/README.md): **`vendor/`** (не в git) → **`geo:sync`** → **`artifacts/`** (коммитимые файлы + манифест).

### Geo tooling: что за что отвечает

- `geo:vendor` — скачивает/обновляет внешние репозитории регионов в `data/geo/vendor`.
- `geo:sync` — режет и переносит нужные файлы в `data/geo/artifacts` + пишет `manifest.json`.
- `geo:verify` — проверяет SHA-256 каждого артефакта против манифеста.
- `geo:seed` — заносит метаданные артефактов в `geo_dataset_file`.
- `geo:db:plan` — dry-run diff синка справочников (что добавится/обновится/деактивируется).
- `geo:db:apply` — применяет diff, пишет audit (`geo_sync_log`) и события outbox.

### Enrichers: use-cases

- **Dadata**: основной провайдер точного адресного обогащения (город/село/FIAS/координаты).
- **Nominatim**: fallback, когда Dadata не дала уверенный матч.
- **LLM enricher**: OpenAI-compatible адаптер (Ollama по умолчанию), работает как fallback и валидирует ответ через Zod.
- **CompositeEnricher**: цепочка провайдеров по приоритету.
- **CachingEnricher**: сначала cache (`place_cache`/in-memory), потом внешние вызовы.
- Базовый сценарий: если регион найден локально, используем словарь; если в тексте есть уточнение — добираем через enrichers.
- Для карт/time-machine статусы place ведутся отдельными тегами (`place_status_active` + `place_status_history`), а `cleared` вычисляется read-side как отсутствие активных тегов.

### LLM runtime config (env)

- `RADAR_STORAGE_MODE`: режим хранилища worker (`memory|db|fs`), по умолчанию `memory`.
- `RADAR_LLM_GEOCODER_ENABLED`: включает/выключает LLM fallback.
- `RADAR_LLM_PROVIDER`: `ollama` или `openai-compatible`.
- `RADAR_LLM_BASE_URL`: endpoint OpenAI-compatible API, по умолчанию `http://127.0.0.1:11434/v1`.
- `RADAR_LLM_MODEL`: имя модели в runtime (`qwen2.5:3b` и т.п.).
- `RADAR_LLM_TIMEOUT_MS`, `RADAR_LLM_RETRY_COUNT`: сетевые guardrails.
- `RADAR_LLM_MAX_TOKENS`, `RADAR_LLM_TEMPERATURE`, `RADAR_LLM_JSON_MODE`: режим генерации.

Подробный гайд по параметрам семплинга, гибридному CPU+GPU режиму и сравнению локальных/облачных моделей:
- [docs/ollama-sampling-and-model-tuning.md](docs/ollama-sampling-and-model-tuning.md)

## Batch parser report

- `worker:parse:report` использует тот же production `ParsePipelineService`, что и Telegram write-side.
- CLI — это transport-обертка для оффлайн проверки качества парсинга и георезолва.
- Дефолты: `--input tests --outdir reports --format json --div file`.
- Для batch-репортов дефолтный режим хранения: `--storage-mode=fs`.
- Поддерживаются форматы: `json|yaml|csv`; режим деления: `file|record`.
- Флаг `--use-providers` включает enrich-цепочку поверх локального artifacts-first резолва.
- Для Ollama snap-check: `npm run worker:parse:snap:ollama -- --input tests/snap_001.txt` (проверяет `/api/tags` и запускает parse через LLM-enabled runtime).

## Worker и Telegram

- Сессии **не в `.env`**: только volume-слоты **`RADAR_SESSIONS_DIR`** (см. `worker:session:deploy`).
- **`TELEGRAM_API_ID` / `TELEGRAM_API_HASH`** — опционально; без них TEST ONLY `api_id` из доки tdesktop (ограничен). Свои — с [my.telegram.org](https://my.telegram.org).
- Первый вход — интерактивный deploy (TTY):

  ```bash
  npm run worker:session:deploy -- --slot tg-user-1 --kind mtproto_user
  npm run worker:session:probe -- --slot tg-user-1
  ```

### Raw Ingest Providers (db mode)

- **`RADAR_STORAGE_MODE=db`** — провайдеры и bindings в PostgreSQL, `IngestOrchestrator` + live Telegram adapters.
- Session slots на volume: **`RADAR_SESSIONS_DIR`** (см. [docs/ingest-providers.md](./docs/ingest-providers.md)).
- Admin: **`POST /api/admin/ingest/messages`** — ручной ingest; Swagger: `/api/docs` → `admin-ingest`.
- CLI (все параметры): **[docs/ingest-providers.md](./docs/ingest-providers.md#cli--справочник-команд)** — session, manifest, backfill.
- Backfill V2 (демон, схемы, эксплуатация): **[docs/backfill-v2-pipeline.md](./docs/backfill-v2-pipeline.md)**.
- CLI: `npm run worker:session:deploy`, `npm run ingest:manifest:import`, `npm run worker:ingest:backfill -- --all-bindings --batch-size=100`.
- Docker worker (profile): `docker compose --profile worker up -d worker`.

## Секреты и dotenv-vault

- Пакет **`dotenv-vault` на npm** — это в основном **CLI** (`npx dotenv-vault`), а не замена `dotenv.config()` для расшифровки в рантайме.
- Локально приложения читают **`dotenv`** и корневой **`.env`** (не коммитится).
- Для зашифрованного репозиторного следа секретов используйте рабочий процесс **dotenv-vault / dotenvx** по их документации и пробрасывайте уже расшифрованные переменные в процесс (или подключите, например, **`@dotenvx/dotenvx`** при необходимости). Файл **`.env.vault`** можно коммитить; ключи — нет.

## Миграции TypeORM

Генерация (пример имени — последний аргумент):

```bash
npm run migration:generate -- src/migrations/RenameMe
```

Применение:

```bash
npm run migration:run
```

Команды выполняются в пакете `@radar/api` через корневые npm-скрипты.

## Полезные скрипты (корень)

| Скрипт            | Назначение                          |
|-------------------|-------------------------------------|
| `npm run cold:up` | холодный старт: Docker, `npm install`, build shared, миграции (без `dev`) |
| `npm run up`      | **Docker + dev:app** (API + web, без worker) |
| `npm run dev`     | shared + API + web + worker (**без** Docker) |
| `npm run dev:app` | shared + API + web (**без** worker) |
| `npm run parse-engine:rebuild` | перепарсить `raw_messages` и обновить проекции карты |
| `npm run worker:map-state:expire` | одноразовый TTL-sweep регионов/places (без полного worker) |
| `npm run ingest:manifest:import` | import провайдеров/каналов из `.radar/ingest.manifest.json` (auto-bootstrap из examples) |
| `npm run worker:ingest:backfill -- --all-bindings --batch-size=100` | backfill по всем enabled каналам (CLI chunk) |
| `npm run bot:dev` | запуск HLD-каркаса admin-bot |
| `npm run start:api` | прод: `node dist/main.js` у API (**нужен** предварительный `npm run build`) |
| `npm run db:up`   | `docker compose up -d` (Postgres + **Adminer** + **pgAdmin**) |
| `npm run db:down` | `docker compose down`               |
| `docker compose --profile llm up -d` | поднять `ollama` вместе с базовыми сервисами |
| `docker compose --profile llm-ui up -d` | поднять `ollama` + `open-webui` для чат-интерфейса |
| `docker compose --profile llm exec ollama ollama pull qwen2.5:3b` | pre-pull модели в локальный runtime |
| `npm run geo:vendor` | shallow clone в `data/geo/vendor` (игнор git) |
| `npm run geo:vendor:pull` | обновить клоны в `vendor/` |
| `npm run geo:sync` | копия в **`data/geo/artifacts`** + `manifest.json` (**коммитим**) |
| `npm run geo:verify` | пересчитать sha256 артефактов и сверить с `manifest.json` |
| `npm run geo:seed` | заполнить **`geo_dataset_file`** из манифеста |
| `npm run geo:db:plan` | dry-run diff для синка справочников в БД |
| `npm run geo:db:apply` | применить diff-синк справочников в БД + аудит |
| `npm run worker:parse:snap -- tests/snap_001.txt` | прогон parser CLI без БД на снапшотах |
| `npm run worker:parse:snap:ollama -- --input tests/snap_001.txt` | snap-прогон с обязательным Ollama probe и LLM-enricher |
| `npm run worker:parse:report -- --input tests --outdir reports --format json --div file` | batch-отчет ParsePipelineService по raw-сообщениям |
| `GET /api/places/status` | активные статус-теги по place (для карты) |
| `GET /api/places/status/history` | история статус-тегов для time-machine |
| `npm run build`   | сборка всех пакетов, где есть build |
| `npm run lint`    | ESLint по исходникам                 |
| `npm run typecheck` | `tsc --noEmit` в пакетах         |
