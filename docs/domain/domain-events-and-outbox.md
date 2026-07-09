# Доменные события и outbox

## Зачем

Единый контракт уведомлений между ingest, parse, geo-sync и подписчиками — и понимание, почему worker и API ведут себя по-разному.

## Envelope `DomainEvent`

Поля (SSOT — Zod):

| Поле | Назначение |
|------|------------|
| `id` | uuid события |
| `type` | `domainEventTypeSchema` |
| `version` | версия схемы payload |
| `occurredAt` | ISO datetime |
| `aggregateType` | логический поток |
| `aggregateId` | id строки потока или null |
| `payload` | произвольный объект |
| `traceId` | опционально |

Файл: `packages/shared/src/schemas/events/domain-event.ts`  
Таблица: `event_outbox` → `DomainEventEntity`.

## Как публикуется (два пути)

### 1. In-process bus (worker по умолчанию)

```
Handler → IEventPublisher.publish → InProcessEventBus
  → синхронный вызов подписчиков по event.type (и "*")
```

- Подписчик parse: `RawMessageIngested` → `rawMessageIngestedSubscriber`.
- **Не пишет** в PostgreSQL.

### 2. Outbox (API и часть сценариев)

```
Service → IDomainEventRepository.append / IDomainEventOutbox.append
  → INSERT event_outbox (published_at = NULL)
```

Позже:

```
OutboxRelay.tick (interval ~1s)
  → SELECT unpublished
  → bus.publish(mapped rows)
  → SET published_at
```

Файлы:

- `packages/api/src/infrastructure/events/outboxRelay.ts`
- `packages/api/src/infrastructure/persistence/typeorm-domain-event.repository.ts`
- `packages/api/src/infrastructure/events/postgresOutboxPublisher.ts` (обёртка append)

### Worker в режиме Db

`createWorkerCompositionRoot` поднимает **и** bus для handlers, **и** `OutboxRelay`.  
События от worker-handlers в outbox **не попадают** — relay разгружает только то, что записали через API (`ingest-admin`, `geo-sync`).

См. [how-it-works.md#events-flow](./how-it-works.md#events-flow).

## Пошагово: relay

1. `find` где `publishedAt IS NULL`, limit 100, order by `occurredAt`.
2. `bus.publish` для каждой строки (те же подписчики, что и для локальных событий).
3. `publishedAt = now`, `save` — **отдельно** от TX подписчиков.

## Где в коде

| Компонент | Путь |
|-----------|------|
| Схема | `packages/shared/.../domain-event.ts` |
| Entity | `packages/api/.../domain-event.entity.ts` |
| Append | `typeorm-domain-event.repository.ts` |
| Admin outbox | `ingest-admin.service.ts` → `publishRawMessageEvent` |
| Geo outbox | `geo-sync-apply.service.ts` → `events.append` |

## FAQ

**Это Event Sourcing?**  
Нет полного rehydrate из журнала — события для интеграции и подписчиков, состояние в таблицах (`mat_ingest_raw`, `mat_parse_event`, …).

**Зачем outbox, если есть bus?**  
Для API и будущей доставки между процессами; worker сегодня обходит outbox для своих событий.

**Потеря событий при падении процесса?**  
In-memory bus — да, для worker-событий. Outbox — только если событие успели `append` в БД.

Gaps: [validation-report.md](./validation-report.md), рекомендации: [architecture-recommendations.md](./architecture-recommendations.md).
