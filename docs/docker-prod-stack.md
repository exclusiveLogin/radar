# Docker prod-стек (baked dist)

Production overlay: `docker-compose.prod.yml` (profile **`prod`**).  
Образы: `docker/Dockerfile.{api,worker,web}` — `dist` собирается **внутри image**, bind-mount исходников нет.

---

## Быстрый старт

```powershell
Copy-Item .env.example .env
npm run db:up
npm run migration:run
npm run docker:prod
# или
npm run radar -- stack docker-prod
```

| URL | Сервис |
|-----|--------|
| http://127.0.0.1:8088 | Web (nginx, `WEB_PORT`) |
| http://127.0.0.1:3000 | API напрямую (`API_PORT`) |
| http://127.0.0.1:8081 | TileServer (`TILES_PORT`) |

---

## Dev vs prod

| | **docker:dev** (`profile app`) | **docker:prod** (`profile prod`) |
|--|-------------------------------|----------------------------------|
| Dockerfile | `Dockerfile.dev` | `Dockerfile.api/worker/web` |
| Код | bind-mount `.:/app` | запечён в image |
| dist | `dev:prepare` на хосте | build в multi-stage |
| api/web | 
est watch` / `vite dev` | 
ode dist` / nginx static |

---

## Команды

```powershell
npm run docker:prod:build     # только build образов
npm run docker:prod           # up -d --build
npm run docker:prod:down

npm run docker:prod:down
npm run docker:prod:assets-check   # после build/up — все файлы в image

npm run radar -- stack docker-prod
npm run radar -- stack docker-prod:build
npm run radar -- stack docker-prod:down
npm run radar -- stack docker-prod:assets-check
```

Миграции (один раз или после обновления):

```powershell
npm run migration:run
# или в контейнере api после старта db
```

---

## Сборка web (VITE_*)

Build-args из `.env` / compose:

- `VITE_MAP_BASEMAP_STYLE` (default `openfreemap`)
- `VITE_MAP_TILES_URL` (default `/tiles` → nginx proxy на `tiles`)

Локальная подложка: `VITE_MAP_BASEMAP_STYLE=local` + `stack tiles:sync` до `docker:prod:build`.

---

## Runtime-ассеты (что должно быть в prod)

### В image (baked)

| Сервис | Пути | Зачем |
|--------|------|-------|
| **api** | `deployment.manifest.json`, `data/geo/**` | `regions-geojson`, geo catalog, adjacency/layout |
| **worker** | manifests (`deployment`, `worker.runtime`, `geo.enrichers`), `data/geo/**`, `data/parse/*.yaml`, `docs/examples/*.json`, `packages/api/dist` | parse pipeline, ingest/backfill, dynamic import api repos |
| **web** | `packages/web/dist` (nginx) | статика SPA |

Проверка одной командой:

```powershell
npm run docker:prod:assets-check
```

### Bind-mount с хоста (не в image)

| Путь | Сервис | Зачем |
|------|--------|-------|
| `./.radar/sessions` | worker-ingest/backfill | Telegram MTProto слоты |
| `./data/tiles/output` | tiles | mbtiles + `config.json` (`stack tiles:sync`) |

### docker:dev

`profile app`: bind-mount `.:/app` — **все** ассеты с хоста. Отдельно смонтированы только sessions и `node_modules`.

### Известные ограничения prod

- **Parse pipeline из админки** (reparse/reset) в API делает `spawn npm -w @radar/worker` — в **api**-image worker нет. Используйте `worker-phase` или CLI на хосте.
- **Ingest/phase manifest** после `manifest:import` живут в **БД**; `docs/examples` нужны только для bootstrap на чистом стенде.
- **`data/geo/vendor`** — только для `geo sync` на хосте, в runtime не нужен.

---

## Файлы

- `docker/Dockerfile.api` — NestJS `packages/api/dist` + `data/geo/`
- `docker/Dockerfile.worker` — worker + api dist + manifests + `data/geo/` + `data/parse/` + `docs/examples/`
- `docker/Dockerfile.web` — vite build + `docker/nginx.web.conf`
- `docker-compose.prod.yml` — api, web, worker-роли, tiles
- `scripts/docker-runtime-assets-check.mjs` — smoke проверки ассетов

Ollama: profile `prod` на сервисе `ollama` в базовом `docker-compose.yml`.
