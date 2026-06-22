# Cold start — чистая система с нуля

PowerShell, корень репозитория. Единый сценарий **0→6** вместо склейки [getting-started.md](./getting-started.md), [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md) и [phase-commands.md](./phase-commands.md).

**CLI:** `npm run radar -- <domain> <action>`. Справочник: [radar-cli.md](./radar-cli.md).

---

## Когда использовать

| Ситуация | Этот runbook |
|----------|--------------|
| Первый запуск на машине | шаг **0** (bootstrap), затем **4→6** без wipe |
| Полный сброс контента БД, ingest/config сохранить | шаги **1→6** |
| Только перелить geo-каталог (raw сохранить) | [runbook/geo-clean-rebuild.md § сценарий B](./runbook/geo-clean-rebuild.md#сценарий-b--перелить-только-каталог-raw-сохранить) |

---

## Минимум в `.env`

```env
DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
RADAR_STORAGE_MODE=db
RADAR_SESSIONS_DIR=.radar/sessions
# TELEGRAM_API_ID / TELEGRAM_API_HASH — my.telegram.org (без них — TEST ONLY ключи Telegram Desktop)
```

Полный список — `.env.example`.

---

## Шаги 0→6

### 0. Bootstrap (один раз на машине)

```powershell
cd C:\path\to\radar
Copy-Item .env.example .env
# отредактировать .env при необходимости

npm run radar -- stack cold-up
npm run build -w @repo/root
npm run build -w @radar/worker

npm run radar -- ingest session:deploy
npm run radar -- ingest session:probe
npm run radar -- ingest manifest:import
```

`stack cold-up`: Docker (Postgres), `npm install`, build shared/api, **миграции**.

> **OSM для geo:** `geo catalog:import` (шаг 4) читает `data/geo/catalog/` и `data/geo/artifacts/`. Если каталога artifacts ещё нет — один раз: `npm run radar -- geo vendor`, затем `npm run radar -- geo sync`. Legacy-цепочка `geo:regions:seed` / `geo:features:import` **не нужна** — всё делает `geo catalog:import`.

Ingest manifest **не** удаляется `system wipe` — каналы и bindings остаются в БД.

---

### 1. Остановить dev перед wipe

> ⚠️ **Обязательно:** остановите `stack dev` / `stack dev --full` (**Ctrl+C**), закройте worker и API. Иначе параллельные записи в БД ломают wipe и TRUNCATE.

Проверка: нет активного `npm run radar -- stack dev` и `worker:dev` в других терминалах.

---

### 2. Полный wipe контента БД

```powershell
npm run radar -- system wipe -- --dry-run   # опционально: посмотреть импакт
npm run radar -- system wipe -- --confirm
```

Удаляет: `raw_messages`, `parsed_events`, `event_locations`, places, regions, `geo_feature`, read-model карты, cursors/backfill, jobs.

**Не трогает:** `channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, Telegram session на диске, файлы `data/geo/`.

Семантика wipe — [phase-commands.md](./phase-commands.md).

---

### 3. Миграции и сборка пакетов worker

```powershell
npm run radar -- stack migrate
npm run build -w @repo/root
npm run build -w @radar/worker
```

`@repo/root` — путь к корню монорепы (нужен worker и tsx CLI). Worker dist — для parse worker_threads при backfill/parse.

---

### 4. Geo-каталог в БД (единая команда)

```powershell
npm run radar -- geo catalog:plan      # опционально: dry-run шагов
npm run radar -- geo catalog:import
```

Импорт: tabular (regions + FIAS) → frontline override → osm_geometry → adjacency.

> После import places получают **новые UUID** — без шага **6** (`parse run`) события не привяжутся к справочнику.

Legacy-команды (`geo:vendor` + `geo:sync` + `geo:features:import` по отдельности) — см. [runbook/geo-clean-rebuild.md § Geo-каталог](./runbook/geo-clean-rebuild.md#geo-каталог--команды); для cold start достаточно **`geo catalog:import`**.

---

### 5. Backfill архива Telegram

```powershell
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
```

Один канал: `--provider-id=<uuid> --binding-id=<uuid>` (UUID — [cheatsheet § SQL](./cheatsheet.md#полезный-sql)).

Требуется: session (шаг 0), enabled bindings, provider `active`, `RADAR_STORAGE_MODE=db`. Демон backfill через Admin UI — [backfill-v2-pipeline.md](./backfill-v2-pipeline.md).

---

### 6. Parse + поднять dev-стек

```powershell
npm run radar -- parse run
npm run radar -- stack dev --full
```

`parse run` = rebuild по `raw_messages` + drain ingest/geo очередей + обновление read-line карты.

Проверка:

| URL | Ожидание |
|-----|----------|
| http://127.0.0.1:3000/api/ready | БД ok |
| http://127.0.0.1:5173 | UI + карта |
| `npm run radar -- pipeline status` | очереди ≈ 0 |

Опционально после прогона: `npm run radar -- pipeline parity`, `npm run radar -- map diagnose` — [runbook § validation](./runbook/geo-clean-rebuild.md#post-rebuild-validation-parse-parity-gate).

---

## Copy-paste (сценарий «уже есть session + manifest»)

```powershell
# 1 — остановить dev вручную (Ctrl+C)

npm run radar -- system wipe -- --confirm
npm run radar -- stack migrate
npm run build -w @repo/root
npm run build -w @radar/worker
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run
npm run radar -- stack dev --full
```

---

## См. также

- [getting-started.md](./getting-started.md) — режимы dev, troubleshooting, ingest live
- [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md) — частичные сценарии (только catalog, только reparse)
- [phase-commands.md](./phase-commands.md) — wipe / reset / clear по фазам
- [cheatsheet.md](./cheatsheet.md) — SQL, backfill, UI
