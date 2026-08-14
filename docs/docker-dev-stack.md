# Docker dev-стек (api + web + worker-роли)

Overlay поверх базового `docker-compose.yml` (Postgres, Adminer, pgAdmin).  
Hot-reload через bind-mount исходников + named volume для 
`node_modules`.

**Порядок docker:dev:** `dev:prepare` (libs → dist) → compose `npm-ci` → `api` healthy → web/workers.  
Без entrypoint-ретраев; app-сервисы `restart: "no"`.

---

## Быстрый старт

```powershell
Copy-Item .env.example .env
npm run docker:dev
# или
npm run radar -- stack docker-dev
```

Первый старт: build libs на хосте + `npm ci` в volume (далее skip по маркеру lock).

Опционально tiles (долго, ~30 GB диск) — **TileServer уже в docker:dev** (stub до артефактов):

```powershell
npm run radar -- stack tiles:sync
```

---

## RabbitMQ + мониторинг (ADR-022)

| Сервис | Порт (dev) | Назначение |
|--------|------------|------------|
| `rabbitmq` | `5672` AMQP, `15672` Management UI | Планирование ingest→parse→geo |
| `prometheus` | `${PROMETHEUS_PORT:-9090}` | Scrape `rabbitmq:15692` |
| `grafana` | `${GRAFANA_PORT:-3002}` | Dashboard метрик Docker-контейнеров |

Переменные: `RMQ_*`, см. `.env.example`. Cascade **только через RMQ** в docker; `worker-parse` / `worker-geo` вместо `worker-phase`.

---

## Архитектура

```mermaid
flowchart TB
  subgraph docker [Docker network radar_net]
    DB[(Postgres :5432)]
    RMQ[rabbitmq :5672 / mgmt :15672]
    API[api :3000]
    WEB[web :5173]
    WI[worker-ingest role=ingest]
    WB[worker-backfill role=backfill]
    WParse[worker-parse role=parse]
    WGeo[worker-geo role=geo + ollama]
    WTrack[worker-tracking role=tracking]
    TS[tiles :8081→8080]
  end
  Browser[Браузер на хосте]
  TG[Telegram]

  Browser -->|/api /ws /tiles| WEB
  WEB --> API
  API --> DB
  TG --> WI
  WI --> DB
  WI -->|RMQ| RMQ
  RMQ --> WParse
  RMQ --> WGeo
  RMQ --> WTrack
  Browser -->|styles| TS
```

| Сервис | Профиль | Порт (хост) | Роль |
|--------|---------|-------------|------|
| `npm-ci` | `app` | — | once: `npm ci` → volume `radar_node_modules` |
| `db` | default | 5432 | PostgreSQL |
| `api` | `app` | 3000 | NestJS REST + WS |
| `web` | `app` | 5173 | Vite + React |
| `worker-ingest` | `app` | 3010 (probe) | live ingest → RMQ |
| `worker-backfill` | `app` | — | backfill daemon |
| `worker-parse` | `app` | — | parse drain |
| `worker-geo` | `app` | — | geo + ollama |
| `worker-tracking` | `app` | — | tracking rebuild |
| `tiles` | `app` | **8081** | TileServer GL (stub до `tiles:sync`) |
| `ollama` | `app` | **11434** | LLM для geo |
| `observability` | `obs` | 3020 | Obs sidecar |

Файлы: через `COMPOSE_FILE` в `.env` (Windows `;`):

```text
COMPOSE_FILE=docker-compose.yml;docker-compose.app.yml;docker-compose.override.yml
```

`docker-compose.override.yml` — NVIDIA GPU для `ollama`. Без GPU убери override из списка.

Дальше достаточно:

```powershell
docker compose --profile app up -d
docker compose --profile llm up -d ollama
docker compose logs -f ollama
```

Не нужно каждый раз писать `-f docker-compose.yml -f docker-compose.app.yml …`.

---

## Ollama (входит в `docker:dev`)

Сервис `ollama` в profile `app`. Модели и конфиг — **named volume** `radar_ollama_data` → `/root/.ollama`.

При старте контейнера `docker/ollama-entrypoint.sh`:
1. поднимает `ollama serve`;
2. проверяет `GEO__llm__model` (из `.env` / manifest overlay, дефолт `qwen2.5:14b`);
3. делает `ollama pull`, если модели нет в volume.

`worker-geo` ждёт **healthy** ollama (модель уже в volume). Первый pull большой модели — до ~30 мин (`start_period` healthcheck).

### GPU (NVIDIA)

Override резервирует все GPU для `ollama`. Нужны: драйвер NVIDIA на хосте, Docker Desktop → Settings → Resources → GPU / WSL2.

Проверка:

```powershell
docker compose --profile llm up -d --force-recreate ollama
docker compose exec ollama nvidia-smi
```

Если `could not select device driver ""` / нет `nvidia-smi` в контейнере — GPU не проброшен (toolkit / Docker Desktop GPU). Без GPU убери `docker-compose.override.yml` из `COMPOSE_FILE`.

Проверка с хоста:

```powershell
curl http://127.0.0.1:11434/api/tags
docker compose logs -f ollama
```

Смена модели: поменять `GEO__llm__model` в `.env` и пересоздать ollama:

```powershell
docker compose up -d --force-recreate ollama
```

| Где | `GEO__llm__baseUrl` |
|-----|---------------------|
| **Хост** (`stack dev`) | `http://127.0.0.1:11434/v1` |
| **worker-geo** (compose) | `http://ollama:11434/v1` |

Open WebUI: `docker compose --profile llm-ui up -d`.

---

## Observability sidecar (`infra.manifest.json` → `infra.obs`)

Флаги в manifest поднимают obs-service (profile `obs`) и переключают worker write-path на `service`.

| Источник | Эффект |
|----------|--------|
| `infra.obs.dockerize: true` | `docker compose --profile obs up -d` |
| `infra.obs.mode: service` | worker push в obs sidecar |
| `INFRA__infra__obs__dockerize=true` | env overlay поверх manifest |

```powershell
# infra.manifest.json или env overlay:
# INFRA__infra__obs__dockerize=true
# INFRA__infra__obs__mode=service
# INFRA__infra__obs__serviceUrl=http://observability:3020

npm run radar -- stack docker-dev
# или host dev:
npm run radar -- stack dev
```

`dev-stack.mjs` / `cold-up.mjs` читают `loadInfraManifest()` — override в `infra.local.json` или `INFRA__*`:

```json
"infra": { "obs": { "dockerize": true, "mode": "service" } }
```

Проверка:

```powershell
curl http://127.0.0.1:3020/health
curl http://127.0.0.1:3020/obs/v1/runtime/snapshot
```

Подробнее: [runbook/observability.md](./runbook/observability.md).

---

## DATABASE_URL: host vs container

| Где запускается | `DATABASE_URL` |
|-----------------|----------------|
| **Хост** (`stack dev`, CLI) | `postgresql://radar:radar@127.0.0.1:5432/radar` |
| **Контейнер** (api, worker-*) | `postgresql://radar:radar@db:5432/radar` (задано в compose) |

Не подставляйте `@db` в `.env` на хосте — только для override в compose.

---

## Worker-роли

`RADAR_WORKER_ROLE` (SSOT: `packages/worker/src/infrastructure/config/workerRole.ts`):

| Роль | Что поднимает |
|------|--------|
| `ingest` | live Telegram ingest |
| `backfill` | backfill jobs (`SKIP LOCKED`) |
| `parse` | ingestParse / coverage drain |
| `geo` | geoParse / place enrichment |
| `tracking` | tracking rebuild launcher |

Роли `all` / `phase` **удалены**. Host: `stack dev` поднимает все 5. Docker: по одному сервису на роль в compose.

### Масштабирование

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml --profile app up --build `
  --scale worker-backfill=2 --scale worker-parse=2
```

Probe API: `WORKER_PROBE_TARGETS=http://worker-ingest:3010/status` (в `.env` для api-контейнера).

---

## Сессии Telegram

Volume `radar_sessions_data` → `/var/radar/sessions` в worker-ingest/backfill.

Деплой с хоста (тот же путь в volume):

```powershell
npm run radar -- ingest session:deploy
```

---

## Web в Docker

| Переменная | В контейнере `web` |
|------------|-------------------|
| `VITE_DEV_PROXY_API` | `http://api:3000` |
| `VITE_DEV_PROXY_TILES` | `http://tiles:8080` |
| `VITE_MAP_TILES_URL` | `/tiles` (браузер → Vite proxy) |
| `VITE_MAP_BASEMAP_STYLE` | `local` |
| `CHOKIDAR_USEPOLLING` | `1` (Windows bind-mount) |

---

## Windows

- **Медленный watch** — `CHOKIDAR_USEPOLLING=1` (уже в compose).
- **
`node_modules`** — volume `radar_node_modules`, не с хоста.
- Пути в PowerShell — обычные; Docker Desktop WSL2 backend рекомендуется.

---

## Команды

| Команда | Действие |
|---------|----------|
| 
`npm run docker:dev` | `compose up --build` profile `app` |
| 
`npm run radar -- stack docker-dev` | то же |
| 
`npm run tiles:up` | только TileServer (profile `tiles`) |
| 
`npm run db:down` | остановить инфраструктуру |

См. также: [map-tiles-selfhost.md](./map-tiles-selfhost.md), [runbook/docker-dev-troubleshooting.md](./runbook/docker-dev-troubleshooting.md).
