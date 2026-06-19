# Runbook: сброс БД, каталог geo, backfill и перепривязка событий



PowerShell, корень репозитория. Нужны `DATABASE_URL`, `RADAR_STORAGE_MODE=db`, Postgres.



**CLI:** [`radar-cli.md`](../radar-cli.md) — `npm run radar -- <domain> <action>`



**Перед мутирующими командами:** остановить dev-стек (Ctrl+C), чтобы worker/api не писали в БД параллельно.



---



## Пайплайн (что к чему)



```

[Telegram / backfill]

        │

        ▼

  raw_messages              ← ingest

        │

        ▼

  message_parse_workspace   ← parse workspace (lineage)

  parsed_events             ← finalize (матч к places в БД)

  event_locations

        │

        ▼

  place_enrichment_jobs     ← geo (dadata/nominatim)

        │

        ▼

  places (trust, coords)    ← обогащение

  fold snapshot             ← read-line карта (без materialized read_model)

```



**Geo-каталог (staging, не runtime parse):**



```

data/geo/catalog/  →  radar geo catalog:import

  [1/4] tabular      regions + FIAS places

  [2/4] frontline    places.json override

  [3/4] osm_geometry geo_feature + link к places

  [4/4] adjacency    region_adjacency

```



После `geo catalog:import` places получают **новые UUID**. Старые `event_locations.place_id` без reparse **не привяжутся** к новому справочнику.



---



## Команды по убыванию импакта

> Полный справочник radar ↔ legacy: [radar-cli.md](../radar-cli.md).

| # | radar (предпочтительно) | Legacy | Импакт |

|---|-------------------------|--------|--------|

| 1 | `radar phase wipe vendor-ingest-parse-geo -- --confirm` | `parse-engine:system:wipe` | 🔴 max |

| 2 | `radar pipeline clear` | `parse-engine:clear` | 🟠 |

| 3 | `radar geo catalog:reset -- --confirm` | `geo:catalog:reset -w @radar/api` | 🟠 |

| 4 | `radar phase wipe geo` | `parse-engine:catalog:wipe` | 🟡 |

| 5 | `radar phase wipe geo-catalog` | `geo-catalog:wipe` | 🟡 |

| 6 | `radar phase wipe ingest-parse` | `ingest-parse:wipe` | 🟡 |

| 7 | `radar pipeline reset` | `parse-engine:reset` | 🟢 |

| 7b | `radar pipeline workspace:heal` | `parse-engine:workspace:heal` | 🟢 |

| 8 | `radar phase wipe geo` (places) | `geo:wipe` | 🟢 |

| 9 | `radar phase reset geo` | `geo:reset` | 🟢 |

| 10 | `parse-engine:catalog:purge-garbage` | — | ⚪ (нет в radar) |

| 11 | `radar phase clear all` | `phase:all:clear` | ⚪ |



Все wipe/reset поддерживают **`-- --dry-run`**.



### `phase wipe vendor-ingest-parse-geo` — детально



Три фазы подряд:



| Фаза | Таблицы / эффект |

|------|------------------|

| ingest:wipe | `raw_messages`, `parsed_events`, `event_locations`, `parse_attempts`, `phase_runs`, `domain_events`, read-model карты, ingest cursors/backfill, jobs, evidence |

| geo:wipe | `places`, `place_aliases` |

| geo-catalog:wipe | `regions`, `geo_feature`, `place_geo_link`, `geo_dataset_file`, `region_state_*` |



**Не трогает:** `channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, файлы `data/geo/catalog` и `data/geo/artifacts` на диске.



> `data reset` и `phase wipe vendor-ingest-parse-geo` **не** удаляют `data/geo/artifacts` — снапшот OSM нужен для `geo catalog:import` (шаг osm). Свежий клон: `vendor:wipe` → `geo:vendor` → `geo:sync`. Полный снос artifacts: `vendor:wipe -- --with-artifacts`.



---



## `reset` vs `rebuild` — привязка к новым places

> Таблица также в [radar-cli § pipeline](../radar-cli.md#pipeline--parse-очереди-сбросы).

| radar | Смысл | Legacy |

|-------|--------|--------|

| `radar pipeline reset` | Сброс parse-результатов, карта, catch-up. **Parse не запускает.** | `parse-engine:reset` |

| `radar pipeline rebuild` | Сброс + прогон по всем `raw_messages` | `parse-engine:rebuild` |

| `radar parse run` | rebuild + scheduled ingest + geo drain | `parse-engine:rebuild:drain`, `parse:run` |



> После переливки каталога нужен **`parse run`** (или `pipeline rebuild` + drain), не только `pipeline reset`.



---



## Сценарий A — чистая система с нуля



```powershell

npm run radar -- phase wipe vendor-ingest-parse-geo -- --confirm

npm run radar -- stack migrate

npm run radar -- geo catalog:import

npm run radar -- ingest backfill -- --all-bindings --batch-size=100

npm run radar -- parse run

npm run radar -- stack dev --full

```



---



## Сценарий B — перелить только каталог (raw сохранить)



```powershell

npm run radar -- geo catalog:reset -- --confirm

npm run radar -- geo catalog:import

npm run radar -- parse run

```



`pipeline reset` **недостаточен** — только очистит parsed. Альтернатива: `reset` + `stack dev --full` (catch-up).



---



## Сценарий C — только перепарс (каталог не менялся)



```powershell

npm run radar -- pipeline reset

npm run radar -- parse run

# или только rebuild без drain:

npm run radar -- pipeline rebuild

```



---



## Geo-каталог — команды



| radar | Legacy |

|-------|--------|

| `radar geo catalog:plan` | `geo:catalog:plan -w @radar/api` |

| `radar geo catalog:import` | `geo:catalog:import -w @radar/api` |

| `radar geo catalog:reset -- --confirm` | `geo:catalog:reset -w @radar/api` |

| `geo:db:apply -w @radar/api` | legacy: tabular + frontline |

| `geo:features:import -w @radar/api` | legacy: osm_geometry |



**Артефакты на диске:**



```

data/geo/catalog/regions.json

data/geo/catalog/03_all_cities.xlsx

data/geo/dictionaries/places.json

data/geo/artifacts/boundaries/...

data/geo/dictionaries/adjacency.json

```



---



## Диагностика перед/после



```powershell

npm run radar -- phase wipe vendor-ingest-parse-geo -- --dry-run

npm run radar -- geo catalog:reset -- --dry-run

npm run radar -- pipeline status

npm run radar -- pipeline queue:ingest

npm run radar -- pipeline queue:geo

```



---



## Post-rebuild validation (parse parity gate)



```powershell

npm run radar -- pipeline parity

npm run radar -- pipeline audit -- --channel=radar-rvk --limit=150 --random

npm run radar -- pipeline audit -- --all-channels --limit=150 --random

npm test -w @radar/worker -- parseWorkspace.golden

npm test -w @radar/shared -- mapStateFold

npm run radar -- map diagnose

```



Отчёты: `reports/parse_parity_inventory.json`, `reports/<channel>_audit_random_<n>.md`.



**Pass (ориентир):** `rawWithoutParsed` ≈ 0; `workspaceDrift` = 0; `not_parsed` gap = 0%; `occurredAtMismatchPct` < 5%.



При fail: `radar pipeline workspace:heal` / `radar geo drain` → повтор audit.



---



## Что никогда не удаляется wipe-командами



`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `status_dictionary`, `.env`, Telegram session, файлы `data/geo/` на диске.



---



## См. также



- [shpargalka-operacii.md](../shpargalka-operacii.md) — общая шпаргалка dev/parse/ingest

- [phase-commands.md](../phase-commands.md) — семантика wipe/reset/clear по фазам

- [adr-005-geo-feature-layer.md](../adr-005-geo-feature-layer.md) — geo_feature и OSM

- [data/geo/README.md](../../data/geo/README.md) — структура артефактов

