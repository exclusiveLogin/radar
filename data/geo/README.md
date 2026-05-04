# Geo-данные в проекте Radar

## Зачем два каталога

| Каталог | В git? | Назначение |
|---------|--------|------------|
| **`data/geo/vendor/`** | нет (`.gitignore`) | Временные **shallow clone** исходных репозиториев |
| **`data/geo/artifacts/`** | **да** | Коммитимый **снапшот** файлов + `manifest.json` + учёт в БД |

Так пайплайн скачивания **не обязателен** на каждой машине: после одного `geo:sync` и push collaborators получают датасет из git.

## Пайплайн (по необходимости)

```bash
npm run geo:vendor      # клоны в vendor/
npm run geo:sync        # копия в artifacts/ + manifest.json
# проверить diff, закоммитить data/geo/artifacts/
```

Обновить уже склонированное:

```bash
npm run geo:vendor:pull
npm run geo:sync
```

## База данных (учёт файлов, связка с FIAS позже)

```bash
npm run migration:run
npm run geo:seed
```

Сидирование читает `data/geo/artifacts/manifest.json` и перезаполняет таблицу **`geo_dataset_file`**.

## Конфигурация источников

Один список репозиториев: **`scripts/geo-sources.json`** (используют Node-скрипты `fetch-geo-vendor.mjs` и `geo-sync-artifacts.mjs`).
