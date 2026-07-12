# Docker dev-стек (api + web + worker-роли)

Overlay поверх базового `docker-compose.yml` (Postgres, Adminer, pgAdmin).  
Hot-reload через bind-mount исходников + named volume для `node_modules`.

**Dist (host + docker):** `dev:prepare` (clean + build) **до** старта процессов/compose.  
`npm run dev` / `docker:dev` / `stack dev` / `stack docker-dev` вызывают его автоматически.  
Watch/entrypoint dist **не сносят**.

---

## Быстрый старт

```powershell
Copy-Item .env.example .env
npm run db:up
npm run docker:dev
# или
npm run radar -- stack docker-dev
```

Первый старт **40–90 с** (entrypoint: `npm ci`, build `@radar/shared` + `@radar/api`).

Опционально tiles (долго, ~30 GB диск) — **TileServer уже в docker:dev** (stub до артефактов):

```powershell
npm run radar -- stack tiles:sync
```

---

## Архитектура

```mermaid
flowchart TB
  subgraph docker [Docker network radar_net]
    DB[(Postgres :5432)]
    API[api :3000]
    WEB[web :5173]
    WI[worker-ingest\nrole=ingest :3010]
    WB[worker-backfill\nrole=backfill]
    WP[worker-phase\nrole=phase]
    TS[tiles :8081→8080]
    OL[ollama :11434]
  end
  Browser[Браузер на хосте]
  TG[Telegram]

  Browser -->|/api /ws /tiles| WEB
  WEB --> API
  WI --> DB
  WB --> DB
  WP --> DB
  WP -->|llm phase| OL
  API --> DB
  TG --> WI
  WI -->|event_outbox outbox| DB
  WP -->|OutboxRelay| DB
  Browser -->|styles| TS
```

| Сервис | Профиль | Порт (хост) | Роль |
|--------|---------|-------------|------|
| `db` | default | 5432 | PostgreSQL |
| `api` | `app` | 3000 | NestJS REST + WS |
| `web` | `app` | 5173 | Vite + React |
| `worker-ingest` | `app` | 3010 (probe) | live ingest → outbox |
| `worker-backfill` | `app` | — | backfill daemon |
| `worker-phase` | `app` | — | parse/geo + OutboxRelay |
| `tiles` | `app` | **8081** | TileServer GL (`data/tiles/output`, stub до `tiles:sync`) |
| `ollama` | `app` | **11434** | LLM для parse/geo phase (`worker-phase` → `http://ollama:11434/v1`) |
| `observability` | `obs` | 3020 | Obs sidecar (push ingest + snapshot read) |

Файлы: `docker-compose.yml`, `docker-compose.app.yml`.

---

## Ollama (входит в `docker:dev`)

Сервис `ollama` в profile `app`. Модели и конфиг — **named volume** `radar_ollama_data` → `/root/.ollama`.

При старте контейнера `docker/ollama-entrypoint.sh`:
1. поднимает `ollama serve`;
2. проверяет `RADAR_LLM_MODEL` (из `.env`, дефолт `qwen2.5:3b`);
3. делает `ollama pull`, если модели нет в volume.

`worker-phase` ждёт **healthy** (модель уже в volume). Первый pull большой модели — до ~30 мин (`start_period` healthcheck).

Проверка с хоста:

```powershell
curl http://127.0.0.1:11434/api/tags
docker compose -f docker-compose.yml -f docker-compose.app.yml logs -f ollama
```

Смена модели: поменять `RADAR_LLM_MODEL` в `.env` и пересоздать ollama:

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --force-recreate ollama
```

| Где | `RADAR_LLM_BASE_URL` |
|-----|----------------------|
| **Хост** (`stack dev`) | `http://127.0.0.1:11434/v1` |
| **worker-phase** (compose) | `http://ollama:11434/v1` |

GPU (опционально): `docker-compose.override.yml` с `deploy.resources.reservations.devices` для `ollama`.

Open WebUI: `docker compose --profile llm-ui up -d`.

---

## Observability sidecar (`deployment.manifest.json` → `infra.obs`)

Флаги в manifest поднимают obs-service (profile `obs`) и переключают worker write-path на `service`.

| Источник | Эффект |
|----------|--------|
| `infra.obs.dockerize: true` | `docker compose --profile obs up -d` |
| `infra.obs.mode: service` | worker push в obs sidecar |
| `DEPLOY__infra__obs__dockerize=true` | env overlay поверх manifest |

```powershell
# deployment.manifest.json или env overlay:
# DEPLOY__infra__obs__dockerize=true
# DEPLOY__infra__obs__mode=service
# DEPLOY__infra__obs__serviceUrl=http://observability:3020

npm run radar -- stack docker-dev
# или host dev:
npm run radar -- stack dev --full
```

`dev-stack.mjs` / `cold-up.mjs` читают `loadDeploymentManifest()` — override в `deployment.local.json` или `DEPLOY__*`:

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

| Роль | Демоны |
|------|--------|
| `ingest` | live ingest, probe; пишет `RawMessageIngested` в outbox |
| `backfill` | backfill jobs (`SKIP LOCKED` claim) |
| `phase` | phase daemons + OutboxRelay (bus → handlers) |
| `all` | всё в одном процессе (host dev) |

### Масштабирование

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml --profile app up --build `
  --scale worker-backfill=2 --scale worker-phase=2
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
- **`node_modules`** — volume `radar_node_modules`, не с хоста.
- Пути в PowerShell — обычные; Docker Desktop WSL2 backend рекомендуется.

---

## Команды

| Команда | Действие |
|---------|----------|
| `npm run docker:dev` | `compose up --build` profile `app` |
| `npm run radar -- stack docker-dev` | то же |
| `npm run tiles:up` | только TileServer (profile `tiles`) |
| `npm run db:down` | остановить инфраструктуру |

См. также: [map-tiles-selfhost.md](./map-tiles-selfhost.md), [runbook/docker-dev-troubleshooting.md](./runbook/docker-dev-troubleshooting.md).
