# Radar

**Radar** — продукт для переноса критичных оповещений о **БПЛА** и ракетных угрозах из хаотичных текстовых каналов в **понятный интерфейс принятия решений**: карта, таймлайн, time machine, уведомления, таймеры подлета и аналитика.

**Запуск всего продукта локально (API, web, worker, БД, ingest):** [docs/getting-started.md](docs/getting-started.md).  
Индекс документации: [docs/README.md](docs/README.md).  
Архитектурный и продуктовый план: [docs/plan.md](docs/plan.md).  
Доменная модель (агрегаты-потоки, события, UoW, карта сущностей): [docs/domain/README.md](docs/domain/README.md).  
Объяснение модели доверия мест (product view): [docs/place-trust-explained.md](docs/place-trust-explained.md).

## 🎯 Миссия

- Превратить поток текстов из каналов в **структурированную оперативную картину** в реальном времени.
- Сократить время от «увидел сообщение» до «понял, что происходит и где риск выше».
- Дать понятный UI, где важное видно сразу: **география, время, динамика, прогноз, архив**.

## 💼 Назначение продукта

| Для кого | Ценность |
|----------|----------|
| Граждане и локальные сообщества | Быстрое понимание обстановки по региону и времени |
| Мониторинговые команды | Централизованный обзор сигналов, меньше ручной рутины |
| Аналитики и редакторы | История событий, heatmap-накопление, фильтруемые выборки |
| Разработка | Единый контур `worker -> API -> web -> data`, воспроизводимые geo-артефакты |

## 🧠 Бизнес-логика

1. **Сбор сигналов**: worker читает сообщения из выбранных каналов (например, региональные «радары», НФ и пр.).
2. **Нормализация**: текст очищается, дедуплицируется и приводится к единой модели события.
3. **Семантика события**: классификация статуса (угроза/подлет/отбой), типа цели, признаков достоверности.
4. **Геопривязка**: извлечение локаций и привязка к геослоям, регионам и объектам.
5. **Временная модель**: формирование таймлайна, life-cycle события и «time machine» по срезам времени.
6. **Прогнозный слой**: ETA-таймеры, предполагаемое направление/курс, зона потенциального прохождения (по правилам и модели).
7. **Подача в UI/API**: карта, лента, пуши/алерты, архив, отчеты и аналитические срезы.

> Важно: сервис повышает наблюдаемость и скорость понимания картины, но не заменяет официальные источники оповещения.

## 🚀 Возможности продукта (цель)

- 🗺️ **Живая карта**: слой событий, фильтры по регионам/типам/достоверности, легенда интенсивности.
- ⏱️ **Таймлайн + Time Machine**: прокрутка по минутам/часам/суткам и восстановление картины на момент времени.
- 🔔 **Умные уведомления**: по геозоне, типу угрозы, уровню уверенности и критичности.
- 🎯 **Таймер подлета и курс**: расчет ориентировочного ETA и направления с визуализацией траектории.
- 🧾 **Архив событий**: полнотекстовый поиск, карточка события, связанные сообщения-источники.
- 🔥 **Heatmap атак/активности**: накопительная тепловая карта по периодам и регионам.
- 📊 **Аналитика**: пики активности, частота по типам, окна эскалации, экспорт срезов.
- 🤖 **Качество данных**: антидубли, валидация источников, скоринг доверия, контроль шумов.

## 🧩 Схема системы

### Поток данных (упрощенно)

```mermaid
flowchart LR
  subgraph src[Источники]
    TG[Telegram каналы]
  end

  subgraph ingest[Ingest & Parse]
    W[Worker GramJS]
    NLP[Парсер и фильтры]
  end

  subgraph data[Data Core]
    DB[(PostgreSQL)]
    GEO[Geo artifacts + manifest]
    ANA[Агрегации и аналитика]
  end

  subgraph api[NestJS API]
    REST[REST / Swagger]
    WS[WebSocket /ws]
  end

  subgraph ui[Web UI]
    MAP[Схема + гео-карта]
    WARN[Предупреждения]
    TL[Таймлайн + Time Machine]
    ARC[Архив и heatmap]
  end

  TG --> W --> NLP --> DB
  GEO --> DB
  DB --> ANA --> REST
  DB --> WS
  REST --> MAP
  WS --> MAP
  REST --> WARN
  WS --> WARN
  REST --> TL
  REST --> ARC
```

### Примерный макет интерфейса

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Radar  [Регион ▼] [Тип ▼] [Достоверность ▼]   [Time Machine: 04.05 06:10]│
├──────────────────────┬────────────────────────────────────────────────────┤
│ Лента событий        │ Карта                                               │
│ • Подлет / ETA 08:12 │  • маркеры угроз                                    │
│ • Отбой              │  • прогноз курса                                    │
│ • Дубликат скрыт     │  • heatmap за период                                │
├──────────────────────┴────────────────────────────────────────────────────┤
│ Таймлайн: 05:40 ─── 06:00 ─── 06:20 ─── 06:40 (play / pause / scrub)      │
└───────────────────────────────────────────────────────────────────────────┘
```

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

## ⚙️ Текущий статус репозитория

- Монорепо: `api`, `worker`, `web`, `shared` — cold start и dev-стек.
- **Карта (MVP):** схема регионов (`layout.json`), гео-карта (MapLibre), лента предупреждений; состояние — `region_state_active` / `place_status_active`.
- **Realtime:** WebSocket `/ws` — snapshot и дельты (`region-state`, `place-state`, `warning`); полигоны регионов — REST `GET /api/map/regions-geojson`.
- Geo-пайплайн: `vendor → artifacts → manifest → geo:seed → geo:db:apply` (контуры субъектов в `data/geo/artifacts/`).
- Ingest/parse в `db`-режиме, backfill, оффлайн-снапшоты в `tests/`.

## Стек

- **Монорепозиторий:** npm workspaces — `packages/api`, `packages/worker`, `packages/web`, **`packages/shared`** (общие Zod-схемы и типы)
- **API:** NestJS, TypeORM, PostgreSQL, Swagger UI по адресу `/api/docs`
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
| [http://127.0.0.1:5173](http://127.0.0.1:5173) | UI (виджеты: схема, гео-карта, предупреждения) |
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
| **Схема** | `regionsByCode$` (layout + stateLevel) |
| **Гео** | контур региона по статусу (GeoJSON) + **точки** places |
| **Предупреждения** | `warnings$` (REST + WS `warning`) |

Поллеры API читают `region_state_history` / `place_status_history` (раз в 1 с). События **до перезапуска API** по WS не переигрываются — только snapshot при connect.

Данные на карте после ingest: `npm run worker:reparse:raw` (пересчёт проекций из `raw_messages`).

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
- CLI: `npm run worker:session:deploy`, `npm run ingest:manifest:import`, `npm run worker:ingest:backfill`.
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
| `npm run worker:reparse:raw` | перепарсить `raw_messages` и обновить проекции карты |
| `npm run worker:map-state:expire` | одноразовый TTL-sweep регионов/places (без полного worker) |
| `npm run bot:dev` | запуск HLD-каркаса admin-bot |
| `npm run start:api` | прод: `node dist/main.js` у API (**нужен** предварительный `npm run build`) |
| `npm run db:up`   | `docker compose up -d` (Postgres + **pgAdmin**) |
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
