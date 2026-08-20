> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.

# ADR-003: Phase-обогащение, накопитель и триггеры eager/lazy

Дата: 2026-05-31  
Статус: Accepted

## Контекст

Парсинг сообщения и его гео-обогащение сейчас живут в одном синхронном
пайплайне (`runGeoPipeline` = `steps[] + FinalizerStep`). Это даёт проблемы:

- LLM/Dadata/Nominatim тяжёлые и нужны не всегда — `reparse` упирается в их латентность.
- Логика сведения результатов размазана: `finalizerMerge.ts` (гео) и монотонный
  merge в `geoValidationService.ts` — два разных места без явного per-field provenance.
- Энричеры жёстко гео-типизированы (`ILocationEnricher` → `LocationCandidate`),
  атрибуты события (`event_type`, `severity`, `repeat`, `count`, `direction`,
  `macro_zone`) рождаются rule-based на parse и пишутся в `mat_parse_event` мимо энричеров.
- LLM привязан прямым `fetch`; OpenRouter/облачные модели не подключить.
- `queue_parse_enrichment` монолитна: одна задача на сообщение, без измерения по провайдеру.

## Решение

### 1. Единая абстракция Phase

**Phase = упорядоченный `Enricher[]` + терминальный `MergeStep`.** «ParsePipeline» —
это и есть фаза. Деления типов «enrich vs merge» нет: массив энричеров,
завершающийся merge-шагом.

- `parse` = классификация (event/noise + `event_type`) + первая фаза с блоком
  энричеров (обычно `[catalog]`, можно `[catalog, llm]`). Catalog — обычный
  enricher, не привилегирован.
- Любая последующая enrich-фаза — та же структура: блок из 1..N энричеров + merge.
- `MergeStep` — терминальный шаг фазы (бывший `FinalizerStep`) со своей логикой
  **trust/precision**; сводит namespace энричеров фазы + текущий накопитель.

### 2. Накопитель = весь parsed event с per-field provenance

Накопитель — **весь parsed event**: гео-поля (`regions`, `places`, `locations`)
+ атрибуты события (`event_type`, `repeat`, `count`, `direction`, `macro_zone`,
`severity`). Каждое поле несёт провенанс `{ value, source, trust, precision }`.

Энричер **field-agnostic**: поставщик произвольных полей с провенансом, не только гео.
Прогон фазы: load accumulator → энричеры пишут namespace → `MergeStep` сводит в
накопитель → persist → пересчёт статуса → WS при изменении.

### 3. Merge — пофайльно по precision + trust (SSOT)

`mergeContribution(accumulator, contribution)` — единственное место правила слияния:
перезаписать поле при более сильном источнике (выше precision-ранк, при равенстве —
выше trust), дописать если поле пустое. Работает по любым полям parsed event.

**Рнвариант:** merge идемпотентен и независим от порядка — результат не зависит
от того, в каком порядке отработали проходы `llm/dadata/nominatim`, а повторный
проход — no-op. Этот инвариант обязан быть покрыт тестом order-independence,
иначе lazy-триггер «в любом порядке» ломается.

### 4. Триггеры eager / lazy (одна абстракция, два запуска)

- ⚡ **eager** — событийный (`MessageParsed`): быстрый синхронный путь (обычно `[catalog]`).
- 🐌 **lazy** — по job/queue: отложенное инкрементальное обогащение
  (`[llm]`, `[dadata]`, `[nominatim]` либо комбинации), запускается job-планировщиком.

Базовая policy доверия источников (наследует ADR-002):
`catalog 1.00`, `dadata 0.95`, `nominatim 0.80`, `llm 0.55`, `operator 1.00`,
`system/rule 0.70`.

### 5. Конфиг фаз: манифест в коде в†’ БД в†’ тумблер в админке

Фазы объявляются в коде как манифест (паттерн ingest-манифеста):
- JSON-шаблон фаз в репо (SSOT структуры) + Zod-схема `phaseManifestSchema`.
- `phase:manifest:import` — идемпотентный upsert в `phase_definitions`, `export` — обратно.
- Сущность фазы в БД несёт `enabled`; **админка только включает/выключает** фазы,
  не авторит их. Авторинг — в коде/манифесте.
- Eager-подписчик (enqueue policy) и lazy job-scheduler читают **enabled-фазы из БД**.

## Свойства зрелости (закладываются явно)

- Сходимость через идемпотентный/коммутативный merge по trust+precision.
- Per-field provenance на каждом поле накопителя.
- Единое ядро исполнения на оба триггера (CLI и job не разъезжаются).
- Статус = проекция накопителя (WS только при изменении).
- Конфиг фаз — данными, а не кодом.

## Альтернативы

- **Монолитный `parse → enrich → finalize`** (отдельная finalize-фаза): отвергнут —
  finalize де-факто энричер; отдельная фаза дублирует merge-логику и плодит сущности.
- **LLM прямым fetch без порта**: отвергнут — нельзя подключить OpenRouter/облако,
  preflight захардкожен под Ollama.
- **Одна задача на сообщение в очереди**: отвергнут — нельзя измерять/масштабировать
  по провайдеру и догонять «обновить позже».

## Последствия

- Плюсы: дешёвый eager-парс (catalog-only), тяжёлые провайдеры — фоном и порционно;
  один SSOT слияния; конфиг фаз без передеплоя; готовность к LLM-структурированию атрибутов.
- Минусы: миграции БД (`queue_parse_enrichment` per-stage, `phase_definitions`); рефактор
  пайплайна на инкрементальный merge; обязательный тест коммутативности merge.

## План развития

Ртерация A (этот ADR): контракт накопителя + абстракция Phase + манифест фаз.  
Ртерация B: `MergeStep` + единый `mergeContribution` + тест order-independence.  
Ртерация C: LLM adapter-порт (Ollama + OpenRouter).  
Ртерация D: per-provider проходы (очередь по `stage` + ранеры).  
Ртерация E: LLM-структуризатор атрибутов + `eventCategory в†’ status_dictionary`.  
Ртерация G: job-планировщик в админке (DB-dispatched, паттерн backfill).

---

## Дополнение v2 (2026-06): унифицированный pipeline

Реализовано поверх итераций A–D:

| Было (v1) | Стало (v2) |
|-----------|------------|
| `kind`: eager / lazy | `trigger`: `eager` \| `scheduled` \| `manual` |
| `queue_parse_enrichment.stage` | `queue_parse_coverage.phase_id` (`catalog`, `llm`, …) |
| `job_runs` / JobDaemon | удалены → `log_parse_phase_run` + `PhaseDaemonService` |
| `parse-catalog` / `enrich-llm` id | Короткие id без префикса |

**Selector** в `policy`: `all-new`, `all-pending`, `head`, `tail`, `range`, `since-cursor` — выбор raw для scheduled/manual enqueue.

**SSOT исполнения:** `PhaseRunner` (eager inline, daemon tick, CLI `worker:phase:run`, `worker:reparse:raw` → фаза `catalog`).

Документация операций: [phase-pipeline.md](./phase-pipeline.md), REST: [api/phases-admin.md](./api/phases-admin.md).

