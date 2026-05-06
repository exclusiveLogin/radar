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

## Use-case сценарии

1. **Первичный импорт регионов на новой машине**
   - `npm run geo:vendor`
   - `npm run geo:sync`
   - `npm run geo:verify`
   - `npm run geo:seed`
   - `npm run geo:db:apply`

2. **Регулярное обновление источников**
   - `npm run geo:vendor:pull`
   - `npm run geo:sync`
   - `npm run geo:verify`
   - `npm run geo:db:plan`
   - `npm run geo:db:apply`

3. **Только проверка целостности перед релизом**
   - `npm run geo:verify`

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

## Runtime enrichment и рост каталога

- `artifacts`/словарь считаются init pre-cache для первичного матчинга.
- В эксплуатации worker уточняет локации через подключенные провайдеры.
- Любой provider-ответ пишется в `place_cache` как provider-aware техлог.
- Если candidate валиден:
  - сначала ищем существующий place (`fias -> alias -> name+region`);
  - при матче добавляем alias из исходного raw-текста;
  - при отсутствии матча создаем новый place и alias.
- Таким образом `places` и `place_aliases` постепенно обогащаются по ходу эксплуатации.

## Конфигурация источников

Один список репозиториев: **`scripts/geo-sources.json`** (используют Node-скрипты `fetch-geo-vendor.mjs` и `geo-sync-artifacts.mjs`).
