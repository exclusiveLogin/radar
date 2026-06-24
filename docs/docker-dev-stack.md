# Docker dev-стек (api + web + worker-роли)

Overlay поверх базового `docker-compose.yml` (Postgres, Adminer, pgAdmin).  
Hot-reload через bind-mount исходников + named volume для `node_modules`.

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

Опционально tiles (долго, ~30 GB диск):

```powershell
npm run radar -- stack cold-up -- -Tiles
# или отдельно
npm run tiles:init
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
  end
  Browser[Браузер на хосте]
  TG[Telegram]

  Browser -->|/api /ws /tiles| WEB
  WEB --> API
  WI --> DB
  WB --> DB
  WP --> DB
  API --> DB
  TG --> WI
  WI -->|domain_events outbox| DB
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
| `tiles` | `tiles` | 8081 | TileServer GL |

Файлы: `docker-compose.yml`, `docker-compose.app.yml`, `docker-compose.tiles.yml`.

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
