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
