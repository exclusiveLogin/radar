# Фикстуры для тестов

Файлы **`snap_*.txt`** — сохранённые **сырые тексты каналов** (снимки сообщений). Нужны для ручной и автоматической проверки **парсера и фильтров** без подключения к Telegram.

При доработке логики разбора или отсечения шума можно добавлять новые снапшоты по тому же принципу.

## Запуск тестов и отчетов

Команды запускаются из корня репозитория.

### 1) Быстрый прогон одного снапшота

```bash
npm run worker:parse:snap -- tests/snap_001.txt --geo-report
```

### 2) Прогон всех снапшотов с отчетом по файлам

```bash
npm run worker:parse:report -- --input tests --outdir reports --format json --div file
```

Результат: `reports/snap_001.json`, `reports/snap_002.json`, `reports/snap_003.json`.

### 2.1) Прогон всей папки с агрегированным отчетом

```bash
npm run worker:parse:report -- --input tests --outdir reports --format json --div none
```

Результат: один агрегированный json-отчет по всем файлам во входной папке.

### 3) Gap-анализ качества парсинга

```bash
node scripts/build-parser-gap-analysis.mjs
```

Результат: `reports/parser-gap-analysis.json` с проблемными кейсами:

- `eventUnknownGeo` — события без гео-привязки;
- `multiRegionCollapsed` — сообщения с несколькими регионами, сведенные к одному;
- `eventTypeNotDetected` — текст похож на событие, но не классифицирован.

> Примечание: `worker:parse:report` очищает `--outdir` на каждом запуске
> (`ensureCleanOutdir`), поэтому `reports/` — времянка. Прогоняйте `parse:report`
> и `build-parser-gap-analysis.mjs` подряд, не рассчитывая на сохранение прошлых отчётов.

## Точки расширения парсинга

### Типы событий и классификация
- Тип события: правила в
  `packages/worker/src/domain/parsing/extractEventType.ts` (порядок важен:
  «отбой» → cleared раньше rocket_threat/danger; опасность/внимание распознаются
  и без слова «бпла»).
- Контент-фильтр (event / noise / meta): паттерны в
  `packages/worker/src/domain/parsing/classifyContentKind.ts`
  (`SUMMARY_PATTERNS` отсекает статистические сводки в `meta`).

### Привязка к местам (place-parsing)
Гео-обогащение собрано как последовательный конвейер шагов
`GeoPipelineStep` (см. `application/geo-pipeline/runGeoPipeline.ts`,
терминальный `MergeStep` всегда добавляется последним, ADR-003). Новый источник топонимов
добавляется одним из двух способов:

1. **Новый шаг** — класс, реализующий интерфейс `GeoPipelineStep`
   (`{ id, run(ctx) }`) по образцу
   `application/geo-pipeline/steps/CatalogStep.ts`: пишет в свой namespace
   `ctx.artifact.<id>`, читает уже заполненные. Регистрируется в порядке
   пайплайна (`enricherChainFactory` / `RADAR_GEO_PIPELINE_ORDER`).
2. **Расширение каталога** — словари/алиасы в `GeoCatalog`
   (`infrastructure/geo-catalog/`), если новый источник статичен и не требует
   отдельного шага.
