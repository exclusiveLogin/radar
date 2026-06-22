# radar CLI — единая точка входа

PowerShell, корень репо:

```powershell
npm run radar -- <domain> <action> [-- флаги...]
npm run radar -- help [stack|pipeline|ingest|parse|geo|phase|map|data|dev]
```

**SSOT таблиц «radar ↔ legacy»** — только этот файл. Остальные доки ссылаются сюда, не дублируют.

Старые `npm run parse-engine:*` / `worker:*` / `dev` остаются алиасами; новый код и runbook — через `radar`.

---

## Частые команды

| Задача | Команда |
|--------|---------|
| Первый запуск | `npm run radar -- stack cold-up` |
| Dev UI+API+worker | `npm run radar -- stack dev --full` |
| Миграции после pull | `npm run radar -- stack migrate` |
| Импорт geo-каталога | `npm run radar -- geo catalog:import` |
| Backfill архива | `npm run radar -- ingest backfill -- --all-bindings --batch-size=100` |
| **Reparse / карта после ingest** | `npm run radar -- parse run` |
| **После deploy P6 (ADR-012)** | `stack migrate` → restart worker → `pipeline reset` → `parse run` → `pipeline parity` |
| Перепарсить без смены каталога | `npm run radar -- pipeline reset` → `parse run` |
| Статус очередей | `npm run radar -- pipeline status` |
| Чистая система | **`system wipe -- --confirm`** → `geo catalog:import` → backfill → `parse run` |

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
| `data` | system reset, migrate |
| `dev` | ws-smoke, heap diff |

---

## Семантика wipe / reset / clear

| Действие | Смысл |
|----------|--------|
| **wipe** | Контент фазы удалён («пустое состояние») |
| **reset** | Снято обогащение (coords, trust, jobs); базовые строки остаются |
| **clear** | Только очереди (`phase_coverage`, `place_enrichment_jobs`) + cancel runs |

Мутирующие команды: **`-- --dry-run`**. Подробнее по фазам, импакту и сценариям — [phase-commands.md](./phase-commands.md).

**Не путать:** `pipeline reset` (операционный сброс parsed, raw остаётся) ≠ `phase wipe parse` (фазовый TRUNCATE).

---

## Справочник по доменам

В колонке **radar** — действие после `npm run radar --`. В **legacy** — старый `npm run …`.

### stack — запуск и инфра

| radar | legacy | Назначение |
|-------|--------|------------|
| `stack cold-up` | `cold:up` | Docker + install + migrate + dev:app |
| `stack up` | `up` | Docker + dev:app |
| `stack dev --full` | `dev` | UI + API + worker |
| `stack dev` | `dev:app` | UI + API без worker |
| `stack db:up` / `db:down` | `db:up` / `db:down` | Postgres compose |
| `stack migrate` | `migration:run` | Миграции БД |
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
| `pipeline queue:ingest` | `parse-engine:queue:ingest` | Очередь phase_coverage |
| `pipeline queue:geo` | `parse-engine:queue:geo` | Очередь place_enrichment_jobs |
| `pipeline runs` | `parse-engine:runs:status` | Активные phase_runs |
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
| `phase clear ingest` | `phase:ingest:clear` | phase_coverage + cancel runs |
| `phase clear geo` | `phase:geo:clear` | place_enrichment_jobs + cancel runs |
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

### data — системный сброс

| radar | legacy | Назначение |
|-------|--------|------------|
| `data migrate` | `migration:run` | Миграции |
| `data reset -- --confirm` | `system:reset -- --confirm` | Wipe БД + legacy geo:init |
| `data reset -- --confirm --wipe-only` | `system:reset -- --wipe-only` | Wipe → потом `geo catalog:import` |

### dev — утилиты

| radar | legacy | Назначение |
|-------|--------|------------|
| `dev ws-smoke` | `node scripts/ws-smoke.mjs` | Проверка WS карты |
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
npm run radar -- stack dev --full

# Geo rebuild
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run
npm run radar -- pipeline parity

# После deploy P6 (parse geo DB scan, ADR-012)
npm run build
npm run radar -- stack migrate
# restart worker
npm run radar -- pipeline reset
npm run radar -- parse run
npm run radar -- pipeline parity
# опционально: npm run radar -- geo catalog:import

# Перепарсить raw без смены каталога
npm run radar -- pipeline reset
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

## Точечный доступ

Любой legacy-скрипт из `package.json` по-прежнему вызывается напрямую. `radar` — маршрутизатор, не полный реестр всех npm-имён.

См. также: [cheatsheet.md](./cheatsheet.md) (ingest, SQL, UI) · [shpargalka-operacii.md](./shpargalka-operacii.md) (REST API, env) · [phase-commands.md](./phase-commands.md) (семантика фаз, FK).
