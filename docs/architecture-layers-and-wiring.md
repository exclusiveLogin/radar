# Архитектура слоев и wiring (DIP)

Документ показывает:
- какие слои есть в `radar`;
- где именно происходит runtime wiring;
- в каком формате данные переходят между слоями;
- где используется Nest, а где свой DI/composition.

---

## 1) Карта слоев

```mermaid
flowchart TB
  subgraph Clients["Клиенты / Внешний мир"]
    TG["Telegram (MTProto/Bot API)"]
    Admin["Admin API client"]
    Web["Web UI / Read API"]
  end

  subgraph AppBoundary["Framework boundary"]
    Nest["packages/api (NestJS)\nControllers + Services + DTO"]
    WorkerEntry["packages/worker\nrunBootstrap + CLI"]
  end

  subgraph AppLayer["Application layer (use cases)"]
    IngestUC["IngestOrchestrator\nBackfillDaemonService\nIngestRawMessageHandler"]
    ParseUC["ParseRawMessageHandler\nParsePipelineService"]
    SessionUC["SessionBootstrapService\nSessionResolver"]
  end

  subgraph Ports["Ports / Contracts (@radar/shared)"]
    Repos["I*Repository\nIEventPublisher\nISessionRuntimeStore\nIRawIngestAdapter"]
    Schemas["Zod schemas + domain types\n(raw/parsed/event DTO)"]
  end

  subgraph Infra["Infrastructure adapters"]
    TgAdapter["TelegramRawIngestAdapter"]
    TypeOrm["TypeORM repositories\n(api package)"]
    SessionFS["FileSessionRuntimeStore"]
    Bus["InProcessEventBus"]
    Outbox["event_outbox + OutboxRelay"]
  end

  Clients --> AppBoundary
  TG --> TgAdapter --> IngestUC
  Admin --> Nest --> TypeOrm
  Web --> Nest
  WorkerEntry --> IngestUC
  WorkerEntry --> ParseUC
  WorkerEntry --> SessionUC

  IngestUC --> Ports
  ParseUC --> Ports
  SessionUC --> Ports

  TypeOrm --> Ports
  TgAdapter --> Ports
  SessionFS --> Ports
  Bus --> Ports
  Outbox --> Ports

  Ports --> Schemas
```

---

## 2) Где проходит DIP и runtime wiring

### Worker: собственный composition root (без Nest DI)

Точка сборки: `packages/worker/src/application/createWorkerCompositionRoot.ts`.

Что происходит:
1. Читается `RADAR_STORAGE_MODE` (`memory`/`db`/`fs`).
2. В `db`-режиме подключается `DataSource` + TypeORM repos.
3. Поднимается `InProcessEventBus`.
4. Собираются use-case классы и в конструкторы прокидываются интерфейсы/адаптеры.
5. Поднимаются `IngestOrchestrator` и `BackfillDaemonService` (если `db` и включен daemon).

Именно здесь domain/application получает реализации портов в рантайме.

### API: Nest как framework-слой

`packages/api/src/app.module.ts` поднимает `ConfigModule`, `TypeOrmModule`, модули `health/read-side/ingest-admin`.

Nest используется как HTTP/container слой для API.

---

## 3) Потоки и форматы данных

## 3.1 Live ingest (Telegram -> raw -> parse)

```mermaid
sequenceDiagram
  autonumber
  participant TG as Telegram
  participant AD as TelegramRawIngestAdapter
  participant OR as IngestOrchestrator
  participant IRH as IngestRawMessageHandler
  participant RAW as IRawMessageRepository
  participant BUS as InProcessEventBus
  participant SUB as rawMessageIngestedSubscriber
  participant PRS as ParseRawMessageHandler
  participant PE as mat_parse_event

  TG->>AD: update/new message
  OR->>AD: startDuty(bindings, sink)
  AD->>IRH: handle(IngestNormalizedMessage)
  Note over AD,IRH: Формат: IngestNormalizedMessage (shared port)
  IRH->>RAW: upsert(RawMessage)
  Note over IRH,RAW: Формат: RawMessage (hash, channelKey, providerKey...)
  IRH->>BUS: publish(RawMessageIngested | RawMessageDuplicate)
  SUB->>PRS: handle(RawMessageWithId)
  PRS->>PE: upsert(ParsedEvent)
```

Ключевые форматы:
- На границе адаптера: `IngestNormalizedMessage`.
- В raw-хранилище: `RawMessage`.
- Между ingest и parse: domain event (`RawMessageIngested`).
- Итог parse: `ParsedEvent`.

## 3.2 Backfill V2 (job -> streamHistory -> тот же ingest/parse)

```mermaid
flowchart LR
  Job["job_ingest_backfill (DB)"] --> Daemon["BackfillDaemonService"]
  Daemon --> Adapter["TelegramRawIngestAdapter.streamHistory"]
  Adapter --> Ingest["IngestRawMessageHandler"]
  Ingest --> Raw["mat_ingest_raw"]
  Ingest --> Bus["InProcessEventBus"]
  Bus --> Parse["ParseRawMessageHandler"]
  Parse --> Parsed["mat_parse_event"]
  Ingest --> Cursors["state_ingest_cursor / backfill state"]
```

Backfill не делает отдельный путь парсинга: использует тот же pipeline, что и live.

## 3.3 Admin/API поток

```mermaid
flowchart TB
  Controller["Nest Controller"] --> Service["IngestAdminService"]
  Service --> Repo["TypeOrm*Repository"]
  Service --> Outbox["TypeOrmDomainEventOutbox (event_outbox)"]
  Outbox --> Relay["OutboxRelay (worker)"]
  Relay --> Bus["InProcessEventBus"]
```

---

## 4) Где используется Nest, а где свой слой DIP

| Зона | Механизм DI | Комментарий |
|------|--------------|-------------|
| `packages/api` | Nest DI + TypeORM module | Framework/container на API границе |
| `packages/worker` | Свой composition root | Чистый runtime wiring в `createWorkerCompositionRoot` |
| `@radar/shared` | Без DI, только контракты | Порты, схемы, типы, инварианты форматов |

Итого: в проекте комбинированный подход — Nest на API-границе, и собственный DIP/composition в worker.

---

## 5) Памятка по точкам расширения

- Добавить новый ingest-источник:
  1) реализовать `IRawIngestAdapter` в infrastructure;
  2) зарегистрировать в `adapterRegistry`;
  3) не менять use-case слой.

- Заменить хранение сессий:
  1) реализовать `ISessionRuntimeStore`;
  2) подложить в `SessionResolver`/composition root.

- Заменить persistence:
  1) новая реализация `I*Repository`;
  2) wiring в composition root (worker) или Nest module (api).

