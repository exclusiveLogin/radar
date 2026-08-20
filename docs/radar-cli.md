# radar CLI — единая точка входа

PowerShell, корень репо:

```powershell
npm run radar -- <domain> <action> [-- флаги...]
npm run radar -- help [stack|pipeline|ingest|parse|geo|phase|map|tracking|data|dev]
```

**SSOT таблиц «radar ↔ legacy»** — только этот файл. Остальные доки ссылаются сюда, не дублируют.

Старые 
`npm run parse-engine:*` / `worker:*` / `dev` остаются алиасами; новый код и runbook — через `radar`.

---

## Частые команды

| Задача | Команда |
|--------|---------|
| Первый запуск | 
`npm run radar -- stack cold-up` |
| Dev UI+API+worker | 
`npm run radar -- stack dev` |
| Миграции после pull | 
`npm run radar -- stack migrate` |
| **Треки: миграция + dev** | `stack migrate` → `stack dev` → Admin **Треки** → ВКЛ |
| **Треки: статус** | 
`npm run radar -- tracking status` |
| **Треки: rebuild** | 
`npm run radar -- tracking rebuild -- --since=2024-01-01T00:00:00Z` |
| Импорт geo-каталога | 
`npm run radar -- geo catalog:import` |
| Backfill архива | 
`npm run radar -- ingest backfill -- --all-bindings --batch-size=100` |
| **Reparse / карта после ingest** | 
`npm run radar -- parse run` (сброс parsed внутри, reset не нужен) |
| **После deploy P6 (ADR-012)** | `stack migrate` → restart worker → `parse run` → `pipeline parity` |
| Сброс parsed без reparse | 
`npm run radar -- pipeline reset` → `stack dev` / catch-up |
| Статус очередей | 
`npm run radar -- pipeline status` |
| Чистая система | **[cold-start.md](./cold-start.md)** — шаги 0→6 |

Полный справочник — § [Справочник по доменам](#справочник-по-доменам). Сценарии wipe — [phase-commands.md](./phase-commands.md). Runbook — [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md).

---

## Домены

| Домен | Назначение |
|-------|------------|
| `stack` | Docker, dev, cold-up, миграции |
| `ingest` | backfill, manifest, Telegram session |
| `pipeline` | очереди, drain, reset/clear, audit, parity, phase:run |
| `parse` | snap, report, **run** (= rebuild + drain) |
| `geo` | catalog import/plan, vendor, layout, drain/check/recover |
| `phase` | wipe / reset / clear по фазам |
| `system` | полный wipe контента БД (`system wipe`) |
| `map` | fold status, diagnose |
| `tracking` | L1 треки: status, rebuild, reset, enable |
| `data` | system reset, migrate |
| `dev` | ws-smoke, heap diff |

---

## Семантика wipe / reset / clear

| Действие | Смысл |
|----------|--------|
| **wipe** | Контент фазы удалён («пустое состояние») |
| **reset** | Снято обогащение (coords, trust, jobs); базовые строки остаются |
| **clear** | Только очереди (`queue_parse_coverage`, `job_geo_place_enrich`) + cancel runs |

Мутирующие команды: **`-- --dry-run`**. Подробнее по фазам, импакту и сценариям — [phase-commands.md](./phase-commands.md).

**Не путать:** `pipeline reset` (операционный сброс parsed, raw остаётся) ≠ `phase wipe parse` (фазовый TRUNCATE).

---

## Справочник по доменам

В колонке **radar** — действие после 
`npm run radar --`. В **legacy** — старый 
`npm run …`.

### stack — запуск и инфра

| radar | legacy | Назначение |
|-------|--------|------------|
| `stack cold-up` | `cold:up` | Docker + install + migrate + dev:app |
| `stack up` | `up` | Docker + dev:app |
| `stack dev` | `dev` | UI + API + 5 worker-ролей |
| `stack dev --app-only` | `dev:app` | UI + API без worker |
| `stack db:up` / `db:down` | `db:up` / `db:down` | Postgres compose |
| `stack migrate` | `migration:run` | Миграции БД |
| `stack docker-dev` | `docker:dev` | Полный стек в Docker (profile `app`) |
| `stack tiles:prepare` | `tiles:prepare` | Артефакты без TileServer (prepare → потом `tiles:up`) |
| `stack tiles:sync` | `tiles:sync` | build pipeline + restart TileServer |
| `stack tiles:up` | `tiles:up` | Только TileServer :8081 (рядом с `stack dev`) |
| `stack tiles:down` | `tiles:down` | Остановить TileServer |
| `stack tiles:verify` | `tiles:verify` | Проверка артефактов |
| `stack tiles:download` … `tiles:build` | `tiles:*` | Пошаговый пайплайн |
| `stack cold-up -- -Tiles` | `cold:up -- -Tiles` | cold-up + tiles:sync |
| `stack cold-up -- -Verbose` | — | подробный вывод CLI-скриптов |
| `build` (корень) | — | Собрать все пакеты |

### ingest — каналы и raw

| radar | legacy | Назначение |
|-------|--------|------------|
| `ingest backfill -- --all-bindings --batch-size=N` | `ingest:run`, `worker:ingest:backfill`, `parse-engine:ingest:backfill` | Пачка backfill |
| `ingest manifest:import` | `ingest:manifest:import` | Каналы JSON → БД |
| `ingest manifest:export` | `ingest:manifest:export` | БД → JSON |
| `ingest session:deploy` | `worker:session:deploy` | Telegram session |
| `ingest session:probe` | `worker:session:probe` | Проверка session |
| `ingest session:invalidate` | `worker:session:invalidate` | Сброс session |
| `ingest drain` | `parse-engine:ingest:drain` | Drain scheduled ingest |

### pipeline — parse, очереди, сбросы

| radar | legacy | Назначение |
|-------|--------|------------|
| **`parse run`** | `parse:run`, `parse-engine:rebuild:drain` | **Rebuild + drain (основной reparse)** |
| `pipeline rebuild` | `parse-engine:rebuild` | Reparse raw без drain |
| `pipeline rebuild:drain` | `parse-engine:rebuild:drain` | = `parse run` |
| `pipeline drain` | `parse-engine:drain` | Догнать ingest + geo очереди |
| `pipeline status` | `parse-engine:status` | Сводка очередей / runs |
| `pipeline reset` | `parse-engine:reset`, `parse-engine:pipeline:reset` | Сброс parsed; **raw остаётся** |
| `pipeline clear` | `parse-engine:clear`, `parse-engine:archive:clear` | raw + parsed + cursors; закрывает dev/API/worker (`--no-force-locks` опционально) |
| `pipeline clear:raw` | `parse-engine:clear:raw` | Только raw |
| `pipeline clear:ingest` | `parse-engine:clear:ingest` | Ingest cursors / backfill |
| `pipeline queue:ingest` | `parse-engine:queue:ingest` | Очередь queue_parse_coverage |
| `pipeline queue:geo` | `parse-engine:queue:geo` | Очередь job_geo_place_enrich |
| `pipeline runs` | `parse-engine:runs:status` | Активные log_parse_phase_run |
| `pipeline ingest:drain` | `parse-engine:ingest:drain` | Drain ingest [`--phase=id`] |
| `pipeline phase:run -- --phase=llm` | `parse-engine:phase:run` | Ручной прогон фазы |
| `pipeline phase:stop` | `parse-engine:phase:stop` | Стоп runs + coverage |
| `pipeline audit -- --channel=…` | `parse-engine:channel:audit` | Parse audit канала |
| `pipeline parity` | `parity:inventory`, `parse-engine:parity:inventory` | SQL inventory raw→locations |
| `pipeline workspace:heal` | `parse-engine:workspace:heal` | Починка workspace |
| `pipeline catalog:heal` | `parse-engine:catalog:heal` | Heal catalog places |
| `pipeline catalog:heal:audit` | `parse-engine:catalog:heal:audit` | Аудит heal |
| `parse-engine:init` | — | Манифест фаз + rebuild (нет в radar) |

### parse — офлайн

| radar | legacy | Назначение |
|-------|--------|------------|
| `parse snap -- tests/snap_001.txt` | `worker:parse:snap` | Snap одного текста |
| `parse snap:ollama -- --input …` | `worker:parse:snap:ollama` | Snap + Ollama |
| `parse inspect -- file.txt --out=tmp/inspect` | `worker:parse:inspect` | Agent debug → md+json dir |
| `parse report -- --input tests --outdir reports` | `worker:parse:report` | Batch-отчёт |

Подробнее inspect vs snap vs report: [parse-inspect.md](./parse-inspect.md).

### geo — каталог и обогащение

| radar | legacy | Назначение |
|-------|--------|------------|
| **`geo catalog:import`** | `geo:catalog:import`, `geo:init`, `geo:run` | **SSOT import** (tabular→frontline→osm→adjacency) |
| `geo catalog:plan` | `geo:catalog:plan` | Dry-run шагов import |
| `geo catalog:reset -- --confirm` | `geo:catalog:reset` | Wipe гео-справочника |
| `geo layout` | `geo:layout:build` | layout.json для схемы |
| `geo front-regions` | `geo:front-regions:build` | front-regions geojson |
| `geo drain` | `parse-engine:geo:drain` | Drain geo jobs |
| `geo check` | `parse-engine:geo:check` | Состояние geo-очереди |
| `geo recover` | `parse-engine:geo:recover` | Разблокировать jobs |
| `geo vendor` | `geo:vendor` | Fetch vendor artifacts |
| `geo vendor:pull` | `geo:vendor:pull` | Pull vendor |
| `geo sync` | `geo:sync` | Sync artifacts |
| `geo verify` | `geo:verify` | Verify artifacts |
| `vendor:run` | `vendor:run` | vendor + sync (диск) |
| `vendor:wipe` | `vendor:wipe` | Удалить `data/geo/vendor` |

Legacy по шагам (не SSOT): `geo:regions:seed`, `geo:features:import`, `geo:db:apply` — см. [data/geo/README.md](../data/geo/README.md).

### phase — wipe / reset / clear

| radar | legacy | Назначение |
|-------|--------|------------|
| `phase wipe ingest` | `ingest:wipe` | raw + parsed + evloc + cursors |
| `phase reset ingest` | `ingest:reset` | noop |
| `phase wipe parse` | `parse:wipe` | parsed + evloc; **raw остаётся** |
| `phase reset parse` | `parse:reset` | noop |
| `phase wipe geo` | `geo:wipe`, `parse-engine:catalog:wipe` | DELETE places |
| `phase reset geo` | `geo:reset` | centroid/trust/jobs |
| `phase wipe geo-catalog` | `geo-catalog:wipe` | regions, geo_feature, links |
| `phase wipe ingest-parse` | `ingest-parse:wipe` | = ingest wipe |
| **`system wipe -- --confirm`** | **`system:wipe`**, `parse-engine:system:wipe` | **Полный wipe контента БД** |
| `phase wipe system -- --confirm` | = `system wipe` | то же (через redirect) |
| `phase wipe vendor-ingest-parse-geo -- --confirm` | `vendor-ingest-parse-geo:wipe` | **устарело** → `system wipe` |
| `phase clear ingest` | `phase:ingest:clear` | queue_parse_coverage + cancel runs |
| `phase clear geo` | `phase:geo:clear` | job_geo_place_enrich + cancel runs |
| `phase clear all` | `phase:all:clear` | Обе очереди |
| `phase manifest:import` / `export` | `phase:manifest:*`, `parse-engine:manifest:*` | Манифест фаз |

### system — полный wipe БД

| radar | legacy | Назначение |
|-------|--------|------------|
| **`system wipe -- --confirm`** | `system:wipe`, `parse-engine:system:wipe` | raw + parsed + places + regions/geo_feature |
| `system wipe -- --dry-run` | — | план без изменений |
| `system wipe -- --verbose` | — | подробный SQL в лог |

Флаги: `--no-force-locks`, env `RADAR_CONFIRM_SYSTEM_WIPE=1`. Детали шагов — [phase-commands.md § system wipe](./phase-commands.md).

### map — read-side

| radar | legacy | Назначение |
|-------|--------|------------|
| `map fold` | `map:fold:status` | Диагностика fold snapshot |
| `map diagnose` | `worker:map-state:diagnose`, `map:diagnose` | Debug map state |

### tracking — L1 треки (Round 2)

| radar | legacy | Назначение |
|-------|--------|------------|
| `tracking status` | `tracking:status` | Watermark, counts, enabled |
| `tracking rebuild -- --since=ISO` | `tracking:rebuild` | Full rebuild за период |
| `tracking reset` | `tracking:reset` | Truncate `trajectory_*` + watermark |
| `tracking enable -- --on` | `tracking:enable` | ВКЛ/ВЫКЛ daemon (`--off`) |

**Admin UI:** `/admin` → секция **Треки** (ВКЛ, Rebuild, Pause, настройки кинематики).

**API read-side:** `GET /api/map/tracks`, `GET /api/map/tracks/flow`.

**Конфиг:** `worker.runtime.manifest.json` → `tracking.*` ([ADR-021](./rfc/adr-021-manifest-env-ssot.md)); `RADAR_WORKER_ROLE=tracking` — только tracking daemon.

Runbook: [runbook/tracking-pipeline.md](./runbook/tracking-pipeline.md).

### data — системный сброс

| radar | legacy | Назначение |
|-------|--------|------------|
| `data migrate` | `migration:run` | Миграции |
| `data reset -- --confirm` | `system:reset -- --confirm` | Wipe БД + legacy geo:init |
| `data reset -- --confirm --wipe-only` | `system:reset -- --wipe-only` | Wipe → потом `geo catalog:import` |

### dev — утилиты

| radar | legacy | Назначение |
|-------|--------|------------|
| `dev ws-smoke` | 
ode scripts/ws-smoke.mjs` | Проверка WS карты |
| `dev heap:diff` | `heap:snapshot:diff` | Diff heap snapshots |

---

## Миграция legacy (важные переименования)

| Было (legacy) | Стало (radar) | Примечание |
|---------------|---------------|------------|
| `parse-engine:reset` (root, до 2026-06) | `pipeline reset` | Раньше ошибочно вёл на `parse:wipe` |
| `parse-engine:clear` (root, до 2026-06) | `pipeline clear` | Раньше ошибочно вёл на `ingest-parse:wipe` |
| `parse-engine:system:wipe` | **`system wipe`** | было `vendor-ingest-parse-geo` |
| `vendor-ingest-parse-geo:wipe` | **`system wipe`** | deprecated alias |
| `parse-engine:catalog:wipe` | `phase wipe geo` | |
| `geo:init` / `geo:run` | `geo catalog:import` | |
| `worker:reparse:raw` (docs) | `parse run` | |

---

## Типовые сценарии

```powershell
# Первый запуск
npm run radar -- stack cold-up
npm run radar -- stack dev

# Geo rebuild
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run
npm run radar -- pipeline parity

# После deploy P6 (parse geo DB scan, ADR-012)
npm run build
npm run radar -- stack migrate
# restart worker
npm run radar -- parse run
npm run radar -- pipeline parity
# опционально: npm run radar -- geo catalog:import

# Перепарсить raw без смены каталога
npm run radar -- parse run

# Чистая система
npm run radar -- system wipe -- --confirm
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run

# Только очереди
npm run radar -- phase clear all -- --dry-run
npm run radar -- phase clear all
npm run radar -- pipeline drain
```

---

## Progress / verbose (cold-up, tiles)

| Команда | Progress stage | Флаги / env |
|---------|----------------|-------------|
| `stack cold-up` | `cold-up` | `-Verbose`, `-Tiles`, `-Geo` |
| `stack tiles:sync` | `tiles:sync` | `--verbose`, `--no-restart` (без TileServer; алиасы `--build-only`, `--no-up`) |
| `stack tiles:download` | per-source | `--verbose` |

### Параллельно с host dev

```powershell
# Терминал 1 — приложение
npm run radar -- stack dev

# Терминал 2 — свои тайлы (sync один раз, потом только up)
npm run radar -- stack tiles:sync -- --verbose
# или если артефакты уже есть:
npm run radar -- stack tiles:up
```

В `.env`: `VITE_MAP_BASEMAP_STYLE=local`, `VITE_MAP_TILES_URL=http://127.0.0.1:8081`

`-q` / `--quiet` — отключает verbose.

### Docker worker scale

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml --profile app up --build `
  --scale worker-backfill=2 --scale worker-phase=2
```

---

## Точечный доступ

Любой legacy-скрипт из `package.json` по-прежнему вызывается напрямую. `radar` — маршрутизатор, не полный реестр всех npm-имён.

См. также: [cheatsheet.md](./cheatsheet.md) (ingest, SQL, UI) · [shpargalka-operacii.md](./shpargalka-operacii.md) (REST API, env) · [phase-commands.md](./phase-commands.md) (семантика фаз, FK).
