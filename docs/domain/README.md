# Доменная модель Radar

Точка входа: **как устроены сущности, «агрегаты», события и транзакции** в коде сегодня — без классического `AggregateRoot`.

## С чего начать

| Документ | Когда читать |
|----------|----------------|
| [how-it-works.md](./how-it-works.md) | Нужен сквозной поток: ingest → parse → outbox |
| [../backfill-v2-pipeline.md](../backfill-v2-pipeline.md) | Докачка архива (Backfill V2): демон, чекпоинты, схемы |
| [model-style.md](./model-style.md) | Путаете ORM entity с доменом, ищете UoW / `mergeObjectContext` |
| [aggregates.md](./aggregates.md) | Нужен каталог `aggregateType` и кто задаёт `aggregateId` |
| [validation-report.md](./validation-report.md) | Аудит: что совпадает с кодом, что — gap |
| [architecture-recommendations.md](./architecture-recommendations.md) | Что менять в архитектуре **после согласования** (код не в этом пакете) |

## Глоссарий (коротко)

| Термин | В Radar значит |
|--------|----------------|
| **Логический агрегат** | Поток изменений с id: пара `aggregateType` + `aggregateId` в [DomainEvent](../../packages/shared/src/schemas/events/domain-event.ts), не класс в коде |
| **Доменный контракт** | Типы и Zod в `@radar/shared` (`RawMessage`, `PlaceRecord`, …) |
| **Persistence** | TypeORM `*Entity` — строки таблиц, без бизнес-методов |
| **Use case** | Handler/service в `packages/worker` / `packages/api` — оркестрация |
| **Outbox** | Таблица `domain_events`, запись через `IDomainEventRepository.append` |
| **Composition root** | Сборка зависимостей (`createWorkerCompositionRoot`, Nest `AppModule`) — **не** Unit of Work |

## Карта документов

```
docs/domain/
├── README.md                      ← вы здесь
├── how-it-works.md                ← сквозные сценарии
├── model-style.md                 ← стиль модели (анемичный ORM vs логика)
├── aggregates.md                  ← каталог aggregateType
├── domain-events-and-outbox.md    ← envelope, bus, relay
├── unit-of-work-and-transactions.md
├── persistence-map.md             ← Entity ↔ shared ↔ port
├── validation-report.md
├── architecture-recommendations.md
└── contexts/
    ├── ingest.md
    └── geo-place.md
```

## Связанные docs (вне `domain/`)

- [docs/plan.md](../plan.md) — продукт и стек
- [docs/ingest-providers.md](../ingest-providers.md) — ingest: агрегаты, dedup, CLI (детально)
- [docs/backfill-v2-pipeline.md](../backfill-v2-pipeline.md) — Backfill V2: демон, чекпоинты, mermaid-схемы
- [docs/place-trust-explained.md](../place-trust-explained.md) — доверие к `place`
- [docs/geo-dataset-schemas.md](../geo-dataset-schemas.md) — geo-таблицы и артефакты

## Где в коде

| Слой | Пакет |
|------|--------|
| Схемы, порты, pure functions | `packages/shared` |
| ORM, Nest API | `packages/api` |
| Worker, composition, parse pipeline | `packages/worker` |
