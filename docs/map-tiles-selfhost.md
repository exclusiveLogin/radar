# Self-host OSM basemap (local dark/light)

Локальные raster-тайлы RF+UA для `VITE_MAP_BASEMAP_STYLE=local`.  
SSOT манифеста: **`data/geo/tiles.manifest.json`** (Zod: `geoBasemapManifest` в `@radar/shared`).

---

## Когда нужно

| Сценарий | Решение |
|----------|---------|
| Быстрый dev без офлайн-карты | CDN: `openfreemap` / `carto` (дефолт) |
| Офлайн / стабильная подложка | `cold:up -Tiles` или `npm run tiles:init` |
| Docker dev с картой | `tiles` profile + `VITE_MAP_BASEMAP_STYLE=local` |

---

## Пайплайн

```text
tiles.manifest.json
  → download (Geofabrik pbf)
  → osmium merge → rf-ua.osm.pbf
  → tilemaker → light.mbtiles (+ dark копия)
  → TileServer GL (config.json)
  → web: /tiles или :8081
```

| Шаг | npm | Время (ориентир) |
|-----|-----|------------------|
| Download RF+UA | `tiles:download` | 5–20 мин |
| Merge | `tiles:merge` | 1–5 мин |
| Tilemaker | `tiles:build` | **30–90 мин**, RAM 8–16 GB |
| Verify + compose | `tiles:init` | 1 мин |

**Диск:** ≥ 30 GB под `data/tiles/` (pbf + 2× mbtiles).

Идемпотентность: существующие файлы **пропускаются** (повторный запуск быстрый).

---

## Команды

```powershell
npm run tiles:download
npm run tiles:merge
npm run tiles:build
npm run tiles:verify
npm run radar -- stack tiles:init          # build + TileServer
npm run radar -- stack tiles:up            # только сервер (артефакты готовы)
npm run radar -- stack tiles:update        # пересборка + restart
npm run radar -- stack tiles:down

npm run radar -- stack cold-up -- -Tiles -Verbose
```

Проверка:

```powershell
curl.exe -s http://127.0.0.1:8081/health
# в .env: VITE_MAP_BASEMAP_STYLE=local
```

Тема карты в UI следует `ThemeMode` (dark/light) → разные style URL.

---

## Progress и verbose

| Команда | Progress | Флаги |
|---------|----------|-------|
| `cold-up` | stage `cold-up` | `-Verbose`, `-Tiles`, `-Geo` |
| `tiles:init` | stage `tiles:init` | `--verbose` / `RADAR_CLI_VERBOSE=1` |
| `tiles:download` | per-source | `--verbose` |

Пример:

```text
[cold-up 3/7] tiles:init ...
[tiles:init] download
[tiles:download] skip rf (russia-latest.osm.pbf, 3500.2 MB)
```

`--quiet` / `-q` — без verbose даже при `RADAR_CLI_VERBOSE`.

---

## Fallback на CDN

Если tilemaker не запускался или TileServer выключен — в `.env`:

```env
# VITE_MAP_BASEMAP_STYLE=openfreemap
```

Карта работает без локальных тайлов.

---

## Docker

`docker-compose.tiles.yml` — сервис `tiles`, порт `${TILES_PORT:-8081}:8080`, volume `data/tiles/output`.

В Docker app overlay web проксирует `/tiles` → `tiles:8080`.

---

## Миграция в ODP (будущее)

Поле `geoBasemapPackId` в domain pack ссылается на тот же контракт, что `tiles.manifest.json`.  
Реализация D2 — не в этой итерации. См. [sdd/odp/README.md](./sdd/odp/README.md).

Stub в манифесте: `odpMigration.geoBasemapPackId`.

---

## Ресурсы и риски

- **RAM tilemaker** — на слабой машине пропустите `-Tiles`.
- **dark theme** — пока копия light mbtiles; отдельный night-профиль tilemaker — позже.
- Troubleshooting: [runbook/docker-dev-troubleshooting.md](./runbook/docker-dev-troubleshooting.md).
