# Фазовые команды (wipe / reset / clear / drain)

**SSOT radar ↔ legacy:** [`radar-cli.md`](./radar-cli.md).

**Полный wipe БД:** `npm run radar -- system wipe -- --confirm` (алиас: `npm run system:wipe -- --confirm`).

> Старое имя `vendor-ingest-parse-geo` — legacy-артефакт пайплайна; **диск vendor не трогает**. Используйте **`system wipe`**.

---

## Семантика действий

| Действие | Смысл |
|----------|--------|
| **wipe** | Контент фазы удалён («пустое состояние») |
| **reset** | Снято только **обогащение** (coords, trust, jobs); базовые строки остаются |
| **clear** | Только **очереди** (`queue_parse_coverage`, `job_geo_place_enrich`, cancel `log_parse_phase_run`) |
| **drain** | Догнать очереди **без удаления** данных |
| **run** | Раскатка / прогон (rebuild, import, backfill) |

Мутирующие wipe/reset/clear: **`-- --dry-run`**.

---

## Wipe — по уровню импакта

| Импакт | Команда (radar) | Что удаляет | Что **не** трогает |
|--------|-----------------|-------------|-------------------|
| 🔴 max | **`system wipe -- --confirm`** | raw + parsed + evloc + cursors/backfill + places + regions/geo_feature | channels, bindings, phase_definitions, session, `.env`, **файлы** `data/geo/` |
| 🟠 | `pipeline clear` | raw + parsed + cursors | places, regions, конфиг; **закрывает dev/API/worker** перед TRUNCATE |
| 🟠 | `geo catalog:reset -- --confirm` | geo-справочник в БД | raw, ingest config |
| 🟡 | `phase wipe ingest-parse` | = ingest wipe (raw + parsed + evloc + jobs) | places, regions |
| 🟡 | `phase wipe geo` | `places`, `place_aliases` (evloc.place_id → null) | regions, geo_feature, raw |
| 🟡 | `phase wipe geo-catalog` | regions, geo_feature, links, dataset registry | нужен пустой `places` до этого |
| 🟡 | `phase wipe parse` | parsed + evloc | **raw остаётся** |
| 🟢 | `pipeline reset` | parse-результаты, карта | raw, каталог |
| 🟢 | `phase reset geo` | coords/trust/enrichment jobs | строки places |
| ⚪ | `phase clear all` | только очереди фаз | все данные |
| ⚪ | `vendor:wipe -- --confirm` | **`data/geo/vendor` на диске** | БД Postgres |

Legacy-алиасы: `parse-engine:system:wipe` → `system:wipe`; `vendor-ingest-parse-geo:wipe` → `system:wipe`.

### `system wipe` — три шага внутри

| Шаг | Таблицы / эффект |
|-----|------------------|
| ingest | `mat_ingest_raw`, `mat_parse_event`, `mat_parse_location`, `log_parse_attempt`, `log_parse_phase_run`, read-model карты, cursors/backfill, jobs |
| geo (places) | `places`, `place_aliases` |
| geo-catalog | `regions`, `geo_feature`, `place_geo_link`, `geo_dataset_file`, `region_state_*` |

---

## Bootstrap / deploy

| Задача | Команда |
|--------|---------|
| Первый раз на машине | `npm run radar -- stack cold-up` |
| Docker + UI/API | `npm run radar -- stack up` |
| Полный dev (+ worker) | `npm run radar -- stack dev` |
| После `git pull` | `npm run radar -- stack migrate` |
| Rebuild пакетов | `npm run build` |
| Telegram session | `npm run radar -- ingest session:deploy` |
| Проверка session | `npm run radar -- ingest session:probe` |

---

## Import манифестов

| Манифест | Import | Export | Wipe удаляет? |
|----------|--------|--------|---------------|
| **Ingest** (каналы) | `ingest manifest:import` | `ingest manifest:export` | ❌ |
| **Phase** (catalog/llm/dadata…) | `phase manifest:import` | `phase manifest:export` | ❌ |

---

## Import каталогов / geo на диске

| Задача | Команда |
|--------|---------|
| **SSOT import в БД** | `geo catalog:import` (tabular → frontline → osm → adjacency) |
| Dry-run шагов | `geo catalog:plan` |
| Скачать vendor | `geo vendor` → `geo sync` или `vendor:run` |
| Wipe vendor на диске | `vendor:wipe -- --confirm` (+ `--with-artifacts` для artifacts) |

После `catalog:import` places получают **новые UUID** → нужен **`parse run`**, не только `pipeline reset`.

---

## Drain (догнать очереди)

| Команда | Назначение |
|---------|------------|
| **`parse run`** | rebuild raw + scheduled ingest drain + geo drain |
| `pipeline drain` | ingest + geo очереди без полного rebuild |
| `pipeline ingest:drain` | только `queue_parse_coverage` |
| `geo drain` | только `job_geo_place_enrich` |
| `ingest drain` | scheduled ingestParse (как тик демона) |
| `pipeline rebuild` | reparse **без** drain |
| `pipeline status` | сводка очередей |

---

## Заметки по отдельным фазам

### ingest

- `phase wipe ingest` — raw + parsed, evloc, cursors/backfill.
- **Не трогает:** places, regions, geo_feature.

### parse

- `phase wipe parse` — parsed + evloc; **raw остаётся**.
- Операционный reparse: `parse run` (сброс parsed + карта внутри команды). `pipeline reset` — только wipe без reparse.

### geo (places)

> ⚠️ `phase wipe geo` обнуляет `mat_parse_location.place_id` перед удалением (FK RESTRICT). Строки evloc остаются.

### geo-catalog

Перед `phase wipe geo-catalog` обычно нужен `phase wipe geo` (пустые places).

---

## Что никогда не удаляется wipe-командами БД

`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `.env`, Telegram session, файлы `data/geo/catalog` и `data/geo/artifacts` (если не `vendor:wipe --with-artifacts`).

---

## Типовые сценарии

```powershell
# Чистая БД (контент), конфиг каналов сохранён
npm run radar -- system wipe -- --confirm
npm run radar -- stack migrate
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run

# Как после git clone (новая машина)
npm run radar -- stack cold-up
npm run radar -- ingest session:deploy
npm run radar -- ingest manifest:import
npm run radar -- phase manifest:import
npm run radar -- geo catalog:import
npm run radar -- stack dev
```

Runbook с FK и сценариями B/C: [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md).
