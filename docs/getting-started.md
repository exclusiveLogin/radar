# Запуск продукта Radar (локально)

Единая инструкция: **что поднять**, **в каком порядке**, **как проверить**.  
Детали ingest/backfill — в отдельных гайдах (ссылки в конце).

---

## Что вы запускаете

```mermaid
flowchart LR
  subgraph host[Ваш ПК]
    Web["web :5173\nReact + Vite"]
    API["api :3000\nNestJS + Swagger"]
    Worker["worker\nGramJS + parse"]
  end
  DB[(PostgreSQL\n:5432)]
  TG[Telegram]

  Web -->|/api proxy| API
  Worker --> DB
  API --> DB
  TG --> Worker
  Worker -->|domain events| API
```

| Компонент | npm-скрипт | Назначение |
|-----------|------------|------------|
| **PostgreSQL** | `npm run db:up` | Данные: события, места, ingest, outbox |
| **@radar/shared** | в составе `dev` | Общие схемы; API ждёт `packages/shared/dist` |
| **API** | `api:dev` / `dev` | REST, Swagger, admin ingest, карта/read-model |
| **Web** | `web:dev` / `dev` | UI |
| **Worker** | `worker:dev` / `dev` | Ingest + parse + outbox relay (в db mode) |

Опционально: **Ollama** (`docker compose --profile llm`), **Adminer** (:8080), **pgAdmin** (:5050).

---

## Режимы (что выбрать)

| Цель | Команды | Worker | `.env` |
|------|---------|--------|--------|
| **Только UI + API** (без Telegram) | `cold:up` → `npm run dev:app` | не нужен | `DATABASE_URL` |
| **Полный dev-стек** | `cold:up` → `npm run dev` | memory (по умолчанию) | как выше |
| **Продукт с live ingest** | + session + manifest + `RADAR_STORAGE_MODE=db` | `worker:dev` db | см. § Ingest |
| **+ архив канала** | + `POST backfill-jobs` или CLI `--all-bindings` | демон / CLI chunk | [backfill-v2-pipeline.md](./backfill-v2-pipeline.md), [cheatsheet.md](./cheatsheet.md) |

---

## Быстрый путь (Windows / PowerShell)

### 1. Первый раз на машине

```powershell
cd C:\path\to\radar
Copy-Item .env.example .env
# Заполнить минимум DATABASE_URL (TELEGRAM_API_ID/HASH опциональны — dev fallback Telegram Desktop)
npm run cold:up
```

`cold:up`: Docker (Postgres + Adminer + pgAdmin), `npm install`, build shared, **миграции**.

Опции cold:up: `-Geo` (geo pipeline), `-Dev` (сразу dev-серверы), `-Llm`, `-LlmUi` — см. [README § Быстрый старт](../README.md#быстрый-старт-windows).

### 2. Каждый рабочий день

```powershell
npm run up
```

Поднимает Docker и **API + web** (без worker). Полный стек с Telegram:

```powershell
npm run dev
```

(если Postgres уже запущен — можно без `up`, только `npm run dev` или `npm run dev:app`).

### 3. Проверка

| URL | Ожидание |
|-----|----------|
| http://127.0.0.1:3000/api/health | `ok` без БД |
| http://127.0.0.1:3000/api/ready | БД доступна |
| http://127.0.0.1:3000/api/docs | Swagger |
| http://127.0.0.1:5173 | OSINT-дашборд (geo, KPI, ленты; правый рейл свёрнут по умолчанию) |
| http://127.0.0.1:8080 | Adminer (PostgreSQL, сервер `db`, учётка из `POSTGRES_*`) |
| http://127.0.0.1:5050 | pgAdmin (логин из `.env`) |
| `GET /api/map/snapshot` | Снапшот карты (регионы + places) |
| `WS /ws` | Realtime: snapshot + `region-state` / `place-state` |

Проверка WS: `node scripts/ws-smoke.mjs` (из корня репо, API должен быть запущен).

---

## `.env` — минимум и полный контур

Скопировать из `.env.example`. Ключевые переменные:

Скопируйте **`.env.example` → `.env`**. Минимум для ingest:

```env
DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
RADAR_STORAGE_MODE=db
# TELEGRAM_API_ID / TELEGRAM_API_HASH — опционально (без них — ключи Telegram Desktop для dev)
RADAR_SESSIONS_DIR=.radar/sessions
```

Сессии Telegram **не** задаются в `.env` — только `worker:session:deploy` в слот (см. ниже).  
Полный актуальный список переменных — **`.env.example`**.

---

## Ingest: от нуля до live-сообщений в БД

Без этого шага worker **не** читает каналы в продуктовом режиме (только memory/demo).

### Шаг A — user-сессия (не в БД, на диске)

```powershell
npm run worker:session:deploy
# по умолчанию слот tg-default-user; или: -- --slot tg-default-user --kind mtproto_user
npm run worker:session:probe
```

Секрет: `<корень репо>/.radar/sessions/tg-default-user/`. В БД только **имя слота** в `credentialRefs` (см. manifest).

### Шаг B — провайдеры и bindings в PostgreSQL

Шаблон каналов (PF, Russia, RVK, RRPFO) подхватывается автоматически при первом `ingest:manifest:import` — если `.radar/ingest.manifest.json` нет, worker **создаёт** его из [ingest.manifest.radar-channels-mtproxy.json](./examples/ingest.manifest.radar-channels-mtproxy.json). Либо положите свой manifest в `.radar/ingest.manifest.json`. Затем:

```powershell
npm run ingest:manifest:import
```

| key | Telegram |
|-----|----------|
| `radar-pf` | `@Radarpf` |
| `radar-russia` | `@radarrussiia` |
| `radar-rvk` | `@radar_rvk` |
| `radar-rrpfo` | `@RRPFO` |

Или создать через Admin API (`/api/docs` → `admin-ingest`).

### Шаг C — worker в db mode

В `.env`: `RADAR_STORAGE_MODE=db`.

```powershell
npm run worker:dev
```

В логах:

```text
Режим хранилища worker: db.
Запуск IngestOrchestrator ...
BackfillDaemon запущен ...   # если не отключён
```

Provider в БД должен быть **`active`**, binding **`enabled`**, для backfill — **`user_mtproto_*`** (не bot-only).

### Шаг D — ручная проверка ingest

```http
POST /api/admin/ingest/messages
```

или дождаться сообщения в привязанном канале → `raw_messages` → `parsed_events`.

Подробный CLI-справочник: [ingest-providers.md § CLI](./ingest-providers.md#cli--справочник-команд).

### Шаг E — backfill архива (CLI, разовая пачка)

Без job в БД — удобно для первичного наполнения:

```powershell
# все enabled каналы, по 100 сообщений
npm run worker:ingest:backfill -- --all-bindings --batch-size=100
```

Один канал: `--provider-id` + `--binding-id` (UUID — SQL в [cheatsheet.md § SQL](./cheatsheet.md#полезный-sql)).

Полная история через демон: [backfill-v2-pipeline.md](./backfill-v2-pipeline.md). Кратко: [cheatsheet § Backfill](./cheatsheet.md#backfill-архив-сообщений).

---

## Как процессы связаны (runtime)

```text
Telegram → IngestOrchestrator (live)
         → IngestRawMessageHandler → raw_messages
         → InProcessEventBus (RawMessageIngested)
         → ParseRawMessageHandler (+ worker_threads pool)
         → parsed_events

API (admin) → domain_events (outbox) → OutboxRelay → та же шина в worker

BackfillDaemon (отдельно от Orchestrator) → streamHistory → тот же ingest/parse
```

Схемы: [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md), [domain/how-it-works.md](./domain/how-it-works.md), backfill: [backfill-v2-pipeline.md](./backfill-v2-pipeline.md).

---

## Geo (опционально, для качества мест)

Если нужны регионы в БД и структурная геометрия (карта районов):

```powershell
npm run cold:up -- -Geo
```

**Чистый лист:** [phase-commands.md](./phase-commands.md) — `npm run system:reset -- --confirm`

или вручную:

```powershell
npm run geo:regions:seed    # → regions + place(kind=region) из catalog/regions.json
npm run geo:vendor          # → скачать OSM GeoJSON
npm run geo:sync            # → geo_dataset_file
npm run geo:seed            # → geo_dataset_file manifest
npm run geo:features:import # → geo_feature + catalog place(kind=district) + place_geo_link
```

Геокаталог:
- `data/geo/catalog/regions.json` — 89 субъектов РФ (SSOT).
- `geo:features:import` заполняет `geo_feature` (районы/субъекты OSM) и создаёт catalog-places для parse-матча.
- `GET /api/map/districts-geojson` — новый endpoint для GeoJSON районов.

Подробности архитектуры: [adr-005-geo-feature-layer.md](./adr-005-geo-feature-layer.md).

---

## Полезные команды (корень репо)

| Команда | Назначение |
|---------|------------|
| `npm run cold:up` | Первая настройка: Docker + install + migrations |
| `npm run up` | Docker + `dev:app` (shared + API + web, **без** worker) |
| `npm run dev` | Без Docker: shared + API + web + worker (`dev-stack --full`) |
| `npm run dev:app` | Без Docker и без worker (только UI + API) |
| `npm run migration:run` | Миграции TypeORM |
| `npm run system:reset -- --confirm` | vendor + full wipe БД + `vendor:run` + `geo:run` |
| `npm run ingest:wipe -- --dry-run` | План сноса raw+parsed (см. phase-commands.md) |
| `npm run worker:parse:report -- --input tests` | Оффлайн-тест парсера без Telegram |
| `npm run worker:ingest:backfill -- --all-bindings --batch-size=100` | Backfill всех каналов (CLI chunk) |
| `npm run build` | Production build всех пакетов |

---

## Частые проблемы

| Симптом | Решение |
|---------|---------|
| API не стартует, ошибка shared | `npm run shared:dev` или `npm run dev` (ждёт `shared/dist`) |
| `/api/ready` падает | `docker compose up -d`, проверить `DATABASE_URL` |
| Worker `memory`, ingest не в БД | `RADAR_STORAGE_MODE=db`, перезапуск worker |
| Нет сообщений из Telegram | session deploy, manifest, provider `active`, `TELEGRAM_API_ID/HASH` |
| Backfill `pending` | worker db + лог `BackfillDaemon запущен` — [backfill-v2-pipeline.md § запуск](./backfill-v2-pipeline.md#инструкция-по-запуску-backfill-v2) |

---

## Дальше по документации

- [cheatsheet.md](./cheatsheet.md) — шпаргалка: ingest, backfill, SQL, UI  
- [ingest-providers.md](./ingest-providers.md) — binding modes, manifest, bot vs MTProto  
- [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) — задачи архива  
- [domain/README.md](./domain/README.md) — агрегаты, события, транзакции  
- [plan.md](./plan.md) — продуктовый план
