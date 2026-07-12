# Docker dev — troubleshooting

Типовые сбои при `docker:dev`, tiles и worker probe.

---

## TileServer / tiles timeout

**Симптом:** `error from registry: denied` при `tiles:merge` / `docker pull`.

**Причина:** `ghcr.io/osmcode/osmium-tool` требует авторизацию или недоступен анонимно.

**Fix (уже в репо):** дефолт `iboates/osmium:latest` (Docker Hub). Переопределение:

```env
TILES_OSMIUM_IMAGE=iboates/osmium:latest
```

или в `data/geo/tiles.manifest.json` → `docker.osmium`.

Проверка:

```powershell
docker pull iboates/osmium:latest
npm run radar -- stack tiles:merge -- --verbose
```

---

## TileServer / tiles timeout (сервис)

**Симптом:** карта пустая, `VITE_MAP_BASEMAP_STYLE=local`, 502 на `/tiles`.

**Проверка:**

```powershell
docker compose -f docker-compose.yml -f docker-compose.tiles.yml --profile tiles ps
curl.exe -s http://127.0.0.1:8081/health
Test-Path data/tiles/output/config.json
```

**Fix:** `npm run tiles:sync` или `npm run tiles:up`. Временно — CDN basemap в `.env`.

---

## EADDRINUSE probe (3010)

**Симптом:** worker-ingest не стартует, порт занят.

**Fix:** сменить `WORKER_PROBE_PORT` в `.env` и проброс в `docker-compose.app.yml`, либо остановить host worker на 3010.

---

## Worker: «Модуль API не найден … persistence/index.js»

**Симптом:** `worker-ingest` падает до старта, `packages/api/dist/infrastructure/persistence/index.js` отсутствует.

**Причина:** гонка — worker стартовал раньше полной сборки API на общем volume.

**Политика:** clean+build — **`npm run dev:prepare`** до `stack dev` / `docker:dev`; runtime dist не трогают.

**Fix:** пересобрать образы и поднять заново (entrypoint ждёт `persistence/index.js` + `/api/ready`):

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml --profile app up -d --build
```

Workers ждут `api: service_healthy`.

---

**Симптом:** Vite/worker перезапускаются с задержкой, CPU idle.

**Fix:** `CHOKIDAR_USEPOLLING=1` (уже в compose). Использовать WSL2 backend Docker Desktop. `node_modules` — только в volume `radar_node_modules`.

---

## tilemaker shapefile / bbox

**Симптом:** `Can't read shapefiles unless a bounding box is provided`, exit **1**.

**Причина:** дефолтный `config-openmaptiles.json` в образе ссылается на coastline/landcover shapefile, которых в контейнере нет.

**Fix:** в репо `data/geo/tilemaker-rf-ua.json` (только OSM-слои) + `tilemaker.bbox` в `tiles.manifest.json`. Перезапустить `tiles:build`.

## tilemaker OOM / readBlobHeader

**Симптом:** `tiles:build` падает, `readBlobHeader: unexpected eof`, exit **139**.

**Частые причины:**
1. **Лишний `tilemaker` в docker argv** — entrypoint образа уже запускает бинарник; в CLI только `--input`, `--output`, …
2. **OOM** — RF+UA ~5 GiB; Docker Desktop → Memory **≥ 12–16 GB**; скрипт передаёт `--store` + `--shard-stores`.

**Fix:** обновить скрипт / `tiles:build` заново. При OOM: `$env:TILES_TILEMAKER_EXTRA_ARGS="--threads 2"`.

---

## manifest skip / stale tiles

**Симптом:** после обновления источников карта старая.

**Fix:** удалить `data/tiles/sources/`, `merged/`, `output/` и перезапустить `tiles:sync`.

---

## API не видит worker

**Симптом:** `/api/worker/status` offline в Docker.

**Fix:** в `.env` для api:

```env
WORKER_PROBE_TARGETS=http://worker-ingest:3010/status
```

`WORKER_PROBE_HOST=0.0.0.0` в worker-ingest (уже в compose).

---

## DATABASE_URL в контейнере

**Симптом:** `getaddrinfo ENOTFOUND db` с хоста или наоборот `127.0.0.1` из контейнера.

**Fix:** хост — `@127.0.0.1`; контейнеры — override `@db` в compose (не менять глобальный `.env` на `db`).
