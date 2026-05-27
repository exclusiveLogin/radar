# Архитектурные рекомендации (по gaps)

Документ описывает **что можно улучшить после согласования**. В текущем scope **код не меняется** — только фиксация и рекомендации.

Формат каждого пункта: проблема → риск → как сейчас → варианты → рекомендация → scope.

---

## GAP-1: Worker публикует события мимо outbox

| | |
|--|--|
| **Проблема** | `IngestRawMessageHandler` / `ParseRawMessageHandler` вызывают `InProcessEventBus.publish`, не `IDomainEventRepository.append`, при том что в db-режиме поднят `OutboxRelay`. |
| **Риск** | Нет единого журнала событий; при втором процессе/рестарте подписчики не восстановятся из БД; расхождение с admin ingest (outbox). |
| **Сейчас** | [how-it-works.md#events-flow](./how-it-works.md#events-flow) |
| **Варианты** | A) Worker: `PostgresOutboxPublisher` вместо прямого bus для доменных событий. B) Оставить in-process, документировать как осознанный MVP. C) Dual-write (bus + outbox) в одной TX. |
| **Рекомендация** | **A или C** перед multi-instance worker; для single-process MVP — **B** с явным ADR. |
| **Scope** | Отдельная задача на код + миграция подписчиков |

---

## GAP-2: Ingest — upsert, cursor, publish не атомарны

| | |
|--|--|
| **Проблема** | Три последовательных шага без общей транзакции. |
| **Риск** | Сообщение в БД без обновлённого cursor или без события (редко при sync bus). |
| **Сейчас** | [unit-of-work-and-transactions.md](./unit-of-work-and-transactions.md), [contexts/ingest.md](./contexts/ingest.md) |
| **Варианты** | A) `runInTransaction(manager => { upsert; cursor; outbox append })`. B) Идемпотентный relay/cursor repair job. C) Принять eventual consistency. |
| **Рекомендация** | **A** если включаете outbox в worker; иначе **C** + мониторинг cursor lag. |
| **Scope** | Код + тесты на failure между шагами |

---

## GAP-3: Outbox relay — publish и `publishedAt` не атомарны с эффектами подписчиков

| | |
|--|--|
| **Проблема** | `OutboxRelay.tick`: сначала `bus.publish`, потом `save publishedAt`. Подписчики могут выполнить side effects вне TX с mark published. |
| **Риск** | При падении после publish — повторная доставка (at-least-once); нужны идемпотентные handlers. |
| **Сейчас** | `outboxRelay.ts` |
| **Варианты** | A) Идемпотентность по `event.id` в подписчиках. B) TX: mark processing → publish → mark published. C) Внешняя очередь (NATS/Kafka). |
| **Рекомендация** | **A** минимально сейчас; **B** при росте нагрузки. |
| **Scope** | Код relay + subscribers |

---

## GAP-4: Place merge и evidence — разные вызовы

| | |
|--|--|
| **Проблема** | `GeoValidationService.applyProviderContribution`: `mergeContribution` в TX, `placeEvidence.append` после. |
| **Риск** | Evidence без merge или merge без evidence при сбое. |
| **Сейчас** | [contexts/geo-place.md](./contexts/geo-place.md) |
| **Варианты** | A) Один repo-метод `mergeWithEvidence` в одной TX. B) Saga/compensation. C) Оставить, evidence best-effort. |
| **Рекомендация** | **A** при строгих audit-требованиях; **C** если evidence допускает lag. |
| **Scope** | Код api/worker repos |

---

## GAP-5: Терминология UoW

| | |
|--|--|
| **Проблема** | Composition root воспринимается как UoW. |
| **Риск** | Неверные ожидания атомарности при code review. |
| **Сейчас** | [model-style.md](./model-style.md) |
| **Варианты** | A) Только docs (этот пакет). B) Ввести `IUnitOfWork` / `runInTransaction` в application layer. |
| **Рекомендация** | **A** сделано; **B** только при GAP-2. |
| **Scope** | Docs ✓ / код — по запросу |

---

## GAP-6: События в enum без реализации

| | |
|--|--|
| **Проблема** | `IngestCursorAdvanced`, `IngestProviderCreated`, `SessionSlotDeployed`, … — нет publish. |
| **Риск** | Путаница в контракте API событий; ложные ожидания интеграторов. |
| **Сейчас** | [aggregates.md](./aggregates.md) |
| **Варианты** | A) Реализовать publish в orchestrator/admin. B) Пометить в schema как `planned`. C) Удалить из enum (breaking). |
| **Рекомендация** | **B** в docs/schema comment до реализации; **A** по приоритету ops. |
| **Scope** | Docs/comments или код |

---

## GAP-7: Единый каталог сущностей

| | |
|--|--|
| **Проблема** | 21 entity без навигации. |
| **Риск** | Медленный onboarding. |
| **Сейчас** | [persistence-map.md](./persistence-map.md) |
| **Рекомендация** | Поддерживать map при новых entity; JSDoc `@see` на map. |
| **Scope** | Docs ✓ (этот PR) |

---

## Приоритет (предложение)

| P | Gap | Почему |
|---|-----|--------|
| P1 | GAP-1 | Согласованность event pipeline worker/API |
| P2 | GAP-3 | Идемпотентность при outbox |
| P3 | GAP-2 | Целостность ingest |
| P4 | GAP-4 | Audit place |
| P5 | GAP-6 | Чистота контракта |
| — | GAP-5, GAP-7 | Закрыто документацией |

---

## Что не рекомендуем без явной потребности

- Вводить `AggregateRoot` классы «для красоты» — высокая стоимость, низкая отдача при текущем стиле.
- `mergeObjectContext` — нет ORM-графа агрегатов.
- Полный Event Sourcing — не соответствует текущей модели таблиц состояния.

Фаза реализации — отдельные задачи/ADR после вашего «да».
