# Как это работает (сквозные сценарии)

## Зачем

Один документ для навигации по потокам данных: от сообщения в канале до `parsed_event` и доменных событий — без чтения всех entity подряд.

---

## Ingest-flow {#ingest-flow}

**Цель:** сохранить сырое сообщение один раз (dedup) и запустить parse только для новых.

### Шаги

1. **Адаптер (Слухач)** — висит на сокете Telegram или API, собирает базовый формат и вызывает `IngestRawMessageHandler.handle(...)`.
2. **Оркестрация в Хэндлере** — `IngestRawMessageHandler` считает хэш текста `ingestMessageHash()` (если не передан) и просит репозиторий сохранить.
3. **Репозиторий (БД)** — `IRawMessageRepository.upsert`:
   - проверка по `hash` и identity `(channel, provider, external_message_id, revision_key)`;
   - для Telegram — проверка duplicate в `raw_message_telegram`;
   - при новом сообщении открывает **локальную транзакцию** `dataSource.transaction`, пишет в таблицы и возвращает ID.
4. **Курсор** — если сообщение новое (`inserted: true`) и режим `live`, хэндлер просит базу обновить курсор `cursors.advanceLive(...)` (чтобы после рестарта не читать старое).
5. **Доменное событие** — хэндлер формирует `DomainEvent` (`RawMessageIngested` или `RawMessageDuplicate`) с `aggregateType: raw_message` и `aggregateId` = ID строки.
6. **Публикация** — хэндлер вызывает `IEventPublisher.publish`, который в воркере является `InProcessEventBus`.
7. **Подписчик (Клей)** — шина мгновенно дёргает подписчика `rawMessageIngestedSubscriber`, который читает текст из БД по ID и передаёт его в цепочку Parse.

```mermaid
sequenceDiagram
  box External World
    participant Adapter as Telegram Adapter
  end
  
  box Use Case 1: Ingest
    participant Ingest as IngestRawMessageHandler
  end
  
  box Infrastructure (DB)
    participant Repo as RawMessageRepository
    participant Cursor as IngestCursorRepository
  end
  
  box Event Boundary (In-Memory Bus)
    participant Bus as InProcessEventBus
    participant Sub as rawMessageIngestedSubscriber
  end
  
  box Use Case 2: Parse
    participant Parse as ParseRawMessageHandler
  end

  Adapter->>Ingest: handle(message)
  Note over Ingest,Repo: Транзакция локальна внутри upsert
  Ingest->>Repo: upsert(hash, identity)
  Repo-->>Ingest: inserted id
  opt inserted and live
    Ingest->>Cursor: advanceLive()
  end
  
  Note over Ingest,Bus: Событие пробивает границу Use Case
  Ingest->>Bus: publish(RawMessageIngested)
  Note over Bus,Sub: Синхронный In-Process вызов
  Bus->>Sub: RawMessageIngested
  Sub->>Repo: findById(aggregateId)
  Sub->>Parse: handle(rawMessage)
```

### Где в коде

| Шаг | Файл |
|-----|------|
| Use case ingest | `packages/worker/.../ingestRawMessageHandler.ts` |
| Dedup + TX | `packages/api/.../typeorm-raw-message.repository.ts` |
| Cursor | `packages/api/.../typeorm-ingest-cursor.repository.ts` |
| Подписчик → parse | `packages/worker/.../rawMessageIngestedSubscriber.ts` |
| Admin ingest + outbox | `packages/api/.../ingest-admin.service.ts` |

Подробнее: [contexts/ingest.md](./contexts/ingest.md), инварианты — [docs/ingest-providers.md](../ingest-providers.md).

---

## Backfill-flow (V2) {#backfill-flow}

**Цель:** выкачать архив канала по задаче в БД, не ломая live-курсор; пережить рестарт worker.

Кратко: Admin API создаёт `ingest_backfill_jobs` → **BackfillDaemonService** стримит Telegram (`streamHistory`) → тот же **IngestRawMessageHandler** + **Parse** (classify/geo в `worker_threads`).

```mermaid
flowchart LR
  API[POST backfill-jobs] --> Jobs[(ingest_backfill_jobs)]
  Jobs --> Daemon[BackfillDaemonService]
  Daemon --> Stream[Telegram streamHistory]
  Stream --> Ingest[IngestRawMessageHandler]
  Ingest --> Jobs
  Ingest --> Cursor[(backfill_state)]
  Ingest --> Bus[InProcessEventBus]
  Bus --> Parse[ParseRawMessageHandler]
```

Полные sequence/state/ER-диаграммы, стратегии и env: **[docs/backfill-v2-pipeline.md](../backfill-v2-pipeline.md)**.

---

## Parse-flow {#parse-flow}

**Цель:** из `raw_messages` получить `parsed_events` + геопривязку.

### Шаги

1. **Подписчик** — получает только `raw.id` из базы, загружает текст и вызывает `ParseRawMessageHandler.handle(...)`.
2. **Хэндлер** — передаёт сырой текст в `ParsePipelineService.execute` (в db mode часто через **ParseWorkerPool** в отдельном потоке).
3. **Пайплайн (Классификация + Geo)** — прогоняет текст через классификатор (угроза/спам) и энричеры (DaData, Nominatim, LLM) для поиска локаций.
4. **Отказ** — если это не событие (спам), хэндлер кидает `MessageParseFailed` в шину и выходит.
5. **Валидация (Trust)** — если событие, хэндлер передаёт найденные гео-кандидаты в `GeoValidationService.validate`. Тот проверяет базу: если место уже есть — обновляет статус доверия, вызывает `mergeContribution` (со своей БД транзакцией) и пишет журнал `place_evidence`.
6. **Сохранение** — хэндлер пишет итоговый результат в `parsed_events` и `eventLocations` (без общей транзакции с публикацией в шину).
7. **События** — хэндлер публикует телеметрию энричеров и финальное радостное событие `MessageParsed` (`aggregateType: parsed_event`) в шину.

```mermaid
flowchart TD
  subgraph EventBoundaryIn [Входящая граница: Шина Событий]
    Sub[rawMessageIngestedSubscriber]
  end

  subgraph UseCaseParse [Use Case 2: Разбор и Гео]
    Handler[ParseRawMessageHandler]
    Pipeline[ParsePipelineService]
    Geo[GeoValidationService]
    
    Sub --> |Вызов| Handler
    Handler --> Pipeline
    Pipeline -->|event + geo candidates| Geo
  end

  subgraph Infrastructure [Инфраструктура / БД]
    Merge[(places.mergeContribution)]
    Evidence[(place_evidence.append)]
    Persist[(parsed_events.upsert)]
  end

  subgraph EventBoundaryOut [Исходящая граница: Шина Событий]
    Fail[[MessageParseFailed]]
    Ok[[MessageParsed]]
  end

  Geo -->|Локальная TX| Merge
  Geo --> Evidence
  Evidence --> Persist
  
  Pipeline -->|not event| Fail
  Persist --> Ok
```

| Шаг | Файл |
|-----|------|
| Use case | `packages/worker/.../parseRawMessageHandler.ts` |
| Pipeline | `packages/worker/.../parsePipelineService.ts` |
| Geo + trust | `packages/worker/.../geoValidationService.ts` |

---

## Phase / async-enrich-flow {#enrich-flow}

**Модель (ADR-003):** парсинг и обогащение — одна абстракция **Phase =
упорядоченный `enrichers[]` + терминальный `MergeStep`**. Два триггера:

- ⚡ **eager** — по событию `MessageParsed`, быстрый синхронный путь (обычно `[catalog]`).
- 🐌 **lazy** — по job/queue, отложенно и порционно (`[llm]` / `[dadata]` / `[nominatim]`).

**Накопитель** — весь parsed event (гео-поля + атрибуты события) с per-field
provenance `{ value, source, trust, precision }`. Слияние вклада фазы —
`mergeContribution` (SSOT): пофайльно по precision-рангу, при равенстве — по trust,
затем детерминированный тай-брейк по источнику. Свойства: **идемпотентность**
(повтор прохода — no-op) и **независимость от порядка** проходов (покрыто тестом
`mergeContribution.test.ts`).

### Шаги lazy-прохода

1. **Enqueue policy** — eager-подписчик читает включённые lazy-фазы из
   `phase_definitions` и ставит по задаче на каждый `(raw_message_id, stage)`.
   Enqueue идемпотентен → нет петли ре-энкью.
2. **Stage-ранер** `worker:enrich:run --stage=<llm|dadata|nominatim>` забирает
   пачку (`FOR UPDATE SKIP LOCKED`), прогоняет фазу прохода через тот же
   `ParseRawMessageHandler` (единое ядро eager/lazy), мержит вклад в накопитель.
3. **Пересчёт статуса** — ре-эмит `MessageParsed` → `RegionStateProjection` →
   WS только при изменении уровня.
4. **markDone(stage)**.

### Атрибуты события и статус

Rule-классификатор и LLM — **энричеры атрибутов**: rule даёт `event_type` (выше
trust), LLM-категория (`eventCategory`) заполняет статус, когда правило не
распознало (grey). Мост `eventCategory → status_dictionary.code` data-driven
(словарь — SSOT), решение принимает тот же `mergeContribution`.

### LLM за adapter-портом

`ILlmChatClient` (`OllamaChatClient` / `OpenAiCompatibleChatClient`) изолирует
энричер от провайдера. Выбор по `RADAR_LLM_PROVIDER`; для облака — `RADAR_LLM_API_KEY`
+ заголовки `HTTP-Referer`/`X-Title`.

| Шаг | Файл |
|-----|------|
| Merge SSOT | `packages/shared/src/domain/mergeContribution.ts` |
| MergeStep | `packages/worker/.../geo-pipeline/steps/MergeStep.ts` |
| Очередь per-stage | `packages/worker/.../cli/enrichRunCli.ts` + `typeorm-enrichment-queue.repository.ts` |
| Enqueue policy | `packages/worker/.../subscribers/enrichmentEnqueueSubscriber.ts` |
| LLM-адаптер | `packages/worker/.../enrichers/llmChatClient.ts` |
| Манифест фаз | `packages/worker/.../manifest/phaseManifestLoader.ts` |

---

## Events-flow {#events-flow}

**Два канала публикации:**

| Канал | Кто пишет | Кто читает | Персистентность | Устройство под капотом |
|-------|-----------|------------|-----------------|------------------------|
| **InProcessEventBus** | Worker handlers | Subscribers в том же процессе | Нет (живет в ОЗУ) | Обычная `Map` на чистом TS. Работает синхронно через `for...of` цикл с `await`. Без NestJS, без очередей. Упал подписчик — прервалась цепочка. |
| **Outbox (`domain_events`)** | API: admin, geo-sync | `OutboxRelay.tick` | Да (БД PostgreSQL) | Таблица. Relay поллит её раз в секунду и кидает события в тот же `InProcessEventBus`. |

Worker при `RADAR_STORAGE_MODE=db` поднимает **оба**: handlers шлют в bus напрямую; relay подтягивает **только** строки из БД.

```mermaid
flowchart LR
  subgraph WorkerProcess [Процесс Воркера (В памяти)]
    WH[Worker handlers]
    Bus[InProcessEventBus]
    Relay[OutboxRelay]
    Sub[Subscribers]
    
    WH -->|Прямой publish| Bus
    Relay -->|Трансляция| Bus
    Bus -->|Синхронный вызов| Sub
  end

  subgraph APIProcess [Процессы API]
    API[API services: admin, geo-sync]
  end

  subgraph DB [PostgreSQL]
    Table[(domain_events)]
  end

  API -->|INSERT (append)| Table
  Table -->|Polling (SELECT)| Relay
```

Подробнее: [domain-events-and-outbox.md](./domain-events-and-outbox.md).

---

## Composition-root-flow {#composition-root-flow}

**Worker:** `createWorkerCompositionRoot()` (при `storageMode=db`):

1. `createWorkerDataSource()` — один TypeORM `DataSource`.
2. `createWorkerDbRepositories(dataSource)` — репозитории на этот же source.
3. `new InProcessEventBus()`, подписки (`RawMessageIngested` → parse, метрики).
4. `new OutboxRelay(dataSource, bus)` + `start()` — poll раз в 1s.
5. Handlers, parse pipeline, опционально `IngestOrchestrator`.

**Не делается:** единая транзакция на весь use case; прокидывание `EntityManager` в handlers.

| Файл |
|------|
| `packages/worker/.../createWorkerCompositionRoot.ts` |

Подробнее: [unit-of-work-and-transactions.md](./unit-of-work-and-transactions.md).

---

## Place-trust-flow {#place-trust-flow}

При parse геокандидат может обновить `places`:

1. `GeoValidationService` строит `PlaceContribution`.
2. `IPlaceRepository.mergeContribution` — TX + pessimistic lock, внутри `mergePlaceContribution()` из shared.
3. `IPlaceEvidenceRepository.append` — журнал доказательств (отдельный вызов).

Подробнее: [contexts/geo-place.md](./contexts/geo-place.md), [docs/place-trust-explained.md](../place-trust-explained.md).

---

## С чем путают

| Вопрос | Ответ |
|--------|--------|
| Где создаётся агрегат? | Не `new Aggregate()` — запись в таблицу + `aggregateId` в событии |
| Composition root = UoW? | Нет, только wiring |
| Все события в outbox? | Нет — worker пишет в in-memory bus |
| Parse идёт после commit ingest? | В worker — да, синхронно в том же процессе после `upsert` |
