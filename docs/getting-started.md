# Запуск продукта Radar (локально)

> **Единая инструкция (запуск + настройка):** [setup-and-configuration.md](./setup-and-configuration.md)  
> Этот файл — quickstart и URL-чеклист. Конфигурация — manifest SSOT ([ADR-021](./rfc/adr-021-manifest-env-ssot.md)).

**CLI:** [`radar-cli.md`](./radar-cli.md) — `npm run radar -- <domain> <action>`.  
**Чистая система с нуля:** [`cold-start.md`](./cold-start.md) — сценарий **0→6**.

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
| **API** | `api:dev` / `dev` | REST, Swagger, admin ingest, карта (read-line fold) |
| **Web** | `web:dev` / `dev` | UI |
| **Worker** | `worker:dev` / `dev` | Ingest + parse + outbox relay (в db mode) |

Опционально: **Adminer** (:8080), **pgAdmin** (:5050). **Ollama** (:11434) — в `docker:dev` по умолчанию.

---

## Режимы (что выбрать)

| Цель | Команды (radar) | Worker | `.env` |
|------|-----------------|--------|--------|
| **Только UI + API** (без Telegram) | `stack cold-up` → `stack dev` | не нужен | `DATABASE_URL` |
| **Полный dev-стек (хост)** | `stack cold-up` → `stack dev --full` | `RADAR_WORKER_ROLE=all` | как выше |
| **Docker dev (всё в compose)** | `stack docker-dev` | split: ingest/backfill/phase | см. [docker-dev-stack.md](./docker-dev-stack.md) |
| **Продукт с live ingest** | + session + manifest + `RADAR_STORAGE_MODE=db` | `worker:dev` db | см. § Ingest |
| **+ архив канала** | + `POST backfill-jobs` или `ingest backfill` | демон / CLI chunk | [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) |
| **Локальная карта (OSM tiles)** | `stack cold-up -- -Tiles` | — | `VITE_MAP_BASEMAP_STYLE=local` |

> В таблице — действия после `npm run radar --`. Legacy: `cold:up`, `dev`, `dev:app`.

---

## Быстрый путь (Windows / PowerShell)

### 1. Первый раз на машине

```powershell
cd C:\path\to\radar
Copy-Item .env.example .env
npm run radar -- stack cold-up
```

`stack cold-up`: Docker (Postgres + Adminer + pgAdmin), `npm install`, build shared, **миграции**. Legacy: `npm run cold:up`.

Опции: `-Geo`, `-Tiles` (self-host OSM basemap, долго), `-Dev`, `-Verbose`, `-Llm`, `-LlmUi` — [map-tiles-selfhost.md](./map-tiles-selfhost.md), [docker-dev-stack.md](./docker-dev-stack.md).

**Альтернатива host dev:** `npm run radar -- stack docker-dev` — api/web/worker-роли в Docker ([docker-dev-stack.md](./docker-dev-stack.md)).

---

## Quickstart для нового разработчика (~30 мин)

Минимальный путь «клонировал репо → вижу UI → понимаю пайплайн».

### Шаг 1 — Bootstrap (10 мин)

```powershell
cd C:\path\to\radar
Copy-Item .env.example .env
npm run radar -- stack cold-up
```

### Шаг 2 — Dev-стек без Telegram (5 мин)

```powershell
npm run radar -- stack dev
```

Проверка: http://127.0.0.1:5173 · http://127.0.0.1:3000/api/ready · http://127.0.0.1:8080 (Adminer).

### Шаг 3 — Observability smoke (5 мин)

```powershell
# embedded mode (default в deployment.manifest.json) — нужен worker db mode
$env:RADAR_STORAGE_MODE="db"
npm run worker:dev

# SQL: SELECT host_id, role FROM obs_hosts;
# или sidecar — override в manifest или env:
# DEPLOY__infra__obs__dockerize=true
npm run radar -- stack dev --full
curl http://127.0.0.1:3020/health
```

Admin UI → Workbook observability + Worker runners.

### Шаг 4 — Понять потоки (5 мин)

| Документ | Зачем |
|----------|-------|
| [domain/how-it-works.md](./domain/how-it-works.md) | ingest → parse → events → obs |
| [cheatsheet.md](./cheatsheet.md) | SQL, CLI |
| [runbook/observability.md](./runbook/observability.md) | embedded vs service |

### Шаг 5 — Полный контур (опционально, +1–2ч)

[cold-start.md](./cold-start.md) шаги 0→6: session → manifest → backfill → parse.

Runner platform (dev only):

```powershell
$env:DEPLOY__runners__pipelines__parse__schedulingImpl="runner-platform"
npm run worker:dev
# лог: [odp] parse → runner-platform
```

E2E chaining: [runbook/e2e-bus-chaining.md](./runbook/e2e-bus-chaining.md).

---

### 2. Каждый рабочий день

```powershell
npm run radar -- stack up
```

Поднимает Docker и **API + web** (без worker). Полный стек:

```powershell
npm run radar -- stack dev --full
```

(если Postgres уже запущен — можно `stack dev` / `stack dev --full` без `up`).

### 3. Проверка

| URL | Ожидание |
|-----|----------|
| http://127.0.0.1:3000/api/health | `ok` без БД |
| http://127.0.0.1:3000/api/ready | БД доступна |
| http://127.0.0.1:3000/api/docs | Swagger |
| http://127.0.0.1:5173 | OSINT-дашборд (geo, KPI, ленты; правый рейл свёрнут по умолчанию) |
| http://127.0.0.1:8080 | Adminer (PostgreSQL, сервер `db`, учётка из `POSTGRES_*`) |
| http://127.0.0.1:5050 | pgAdmin (логин из `.env`) |
| http://127.0.0.1:8081 | TileServer GL (после `cold-up -Tiles` или `tiles:sync`) |
| `GET /api/map/snapshot` | Снапшот карты (регионы + places) |
| `WS /ws` | Realtime: snapshot + `region-state` / `place-state` |

Проверка WS: `npm run radar -- dev ws-smoke` (API должен быть запущен).

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

Сессии Telegram **не** задаются в `.env` — только `radar ingest session:deploy` в слот (см. ниже).
Полный актуальный список переменных — **`.env.example`**.

---

## Ingest: от нуля до live-сообщений в БД

Без этого шага worker **не** читает каналы в продуктовом режиме (только memory/demo).

### Шаг A — user-сессия (не в БД, на диске)

```powershell
npm run radar -- ingest session:deploy
npm run radar -- ingest session:probe
```

Секрет: `<корень репо>/.radar/sessions/tg-default-user/`. В БД только **имя слота** в `credentialRefs` (см. manifest).

### Шаг B — провайдеры и bindings в PostgreSQL

Шаблон каналов подхватывается при первом `radar ingest manifest:import` — если `.radar/ingest.manifest.json` нет, worker **создаёт** его из [ingest.manifest.radar-channels-mtproxy.json](./examples/ingest.manifest.radar-channels-mtproxy.json). Затем:

```powershell
npm run radar -- ingest manifest:import
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

или дождаться сообщения в привязанном канале → `mat_ingest_raw` → `mat_parse_event`.

Подробный CLI-справочник: [ingest-providers.md § CLI](./ingest-providers.md#cli--справочник-команд).

### Шаг E — backfill архива (CLI, разовая пачка)

Без job в БД — удобно для первичного наполнения:

```powershell
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
```

Один канал: `--provider-id` + `--binding-id` (UUID — SQL в [cheatsheet.md § SQL](./cheatsheet.md#полезный-sql)).

Полная история через демон: [backfill-v2-pipeline.md](./backfill-v2-pipeline.md). Кратко: [cheatsheet § Backfill](./cheatsheet.md#backfill-архив-сообщений).

---

## Как процессы связаны (runtime)

```text
Telegram → IngestOrchestrator (live)
         → IngestRawMessageHandler → mat_ingest_raw
         → InProcessEventBus (RawMessageIngested)
         → ParseRawMessageHandler (+ worker_threads pool)
         → mat_parse_event

API (admin) → event_outbox (outbox) → OutboxRelay → та же шина в worker

BackfillDaemon (отдельно от Orchestrator) → streamHistory → тот же ingest/parse
```

Схемы: [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md), [domain/how-it-works.md](./domain/how-it-works.md), backfill: [backfill-v2-pipeline.md](./backfill-v2-pipeline.md).

---

## Geo (опционально, для качества мест)

SSOT import в БД — одна команда:

```powershell
npm run radar -- geo catalog:import
```

Полный cold start с wipe и backfill: **[cold-start.md § 0→6](./cold-start.md)** (без legacy `geo:regions:seed` / `geo:features:import`).

Артефакты: `data/geo/catalog/`, `data/geo/artifacts/`. Архитектура: [adr-005-geo-feature-layer.md](./adr-005-geo-feature-layer.md).

---

## Полезные команды (корень репо)

SSOT таблиц radar ↔ legacy: **[radar-cli.md](./radar-cli.md)**. Частые:

```powershell
npm run radar -- stack cold-up
npm run radar -- stack dev --full
npm run radar -- stack migrate
npm run radar -- parse run
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
```

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
