# Отчёт валидации доменной модели

Дата аудита: по состоянию репозитория на момент создания `docs/domain/`.  
Метод: read-only grep и чтение ключевых handlers/repositories.

---

## 1. Логические агрегаты

| Проверка | Статус | Комментарий |
|----------|--------|-------------|
| `aggregateType` в коде соответствует enum в `domain-event.ts` | OK | Все присвоения используют значения из enum |
| Классы `AggregateRoot` / 
ew XxxAggregate` | N/A | Не используются (by design) |
| `aggregateId` для `raw_message` = uuid строки | OK | `IngestRawMessageHandler`, parse handlers |
| `parsed_event` id после `upsert` | OK | `ParseRawMessageHandler` |
| `channel`, `session_slot`, `system` в runtime | Gap | Enum есть, publish не найден |
| События `IngestCursorAdvanced`, `IngestProviderCreated`, … | Gap | В enum, publish не найден |

---

## 2. Ingest-инварианты (docs ↔ code)

| Инвариант (ingest-providers) | Статус | Код |
|------------------------------|--------|-----|
| Dedup hash | OK | `upsert` hash check |
| Dedup identity | OK | identity `findOne` |
| Telegram UNIQUE extension | OK | `findDuplicate` + TX insert |
| Duplicate → event, no parse | OK | subscriber только `RawMessageIngested` |
| Live cursor только для live + insert | OK | handler + `advanceLive` guard |
| Append-only raw | OK | upsert не update текста при duplicate |

---

## 3. Place / trust

| Проверка | Статус | Комментарий |
|----------|--------|-------------|
| `mergePlaceContribution` — монотонный trust | OK | `placeContributionMerge.ts` + tests |
| Merge под lock | OK | `typeorm-place.repository.ts` |
| Evidence после merge | OK (поведение) | Отдельный `append`, не в TX merge |
| Соответствие place-trust-explained | OK | Поля `trustState`, `place_evidence` |

---

## 4. UoW и транзакции

| Проверка | Статус |
|----------|--------|
| Явный `IUnitOfWork` / `UnitOfWork` class | Отсутствует |
| Composition root = wiring only | OK (факт) |
| `dataSource.transaction` | 2 места: raw upsert insert, place merge |
| Ingest use case — одна TX | Gap |
| Parse persist + events — одна TX | Gap |
| Outbox relay publish + mark published | Gap (не одна TX) |

---

## 5. Outbox и события

| Проверка | Статус | Комментарий |
|----------|--------|-------------|
| Worker handlers → `InProcessEventBus` | OK | `createWorkerCompositionRoot` |
| Worker handlers → `event_outbox` | Gap | `append` не вызывается из worker |
| `OutboxRelay` при worker db mode | OK | Поднят, но питает bus из БД |
| API ingest-admin → outbox | OK | `publishRawMessageEvent` |
| API geo-sync → outbox | OK | `events.append` |
| Admin ingest + worker live — два пути событий | Расхождение | Admin в БД, worker в память |

---

## 6. Документация

| Проверка | Статус |
|----------|--------|
| Единый каталог сущностей до `docs/domain` | Gap → закрыт этим пакетом |
| JSDoc `@see` на docs в коде | Gap → задача add-jsdoc-see |
| ingest-providers aggregates table | OK | Согласована с кодом dedup/cursor |

---

## 7. Anemic vs rich (итог)

| Аспект | Оценка |
|--------|--------|
| ORM entities | Анемичные |
| Доменные правила | Shared pure functions + handlers |
| «Взрослые механики» | Ports, events, outbox (частично), repo TX |
| Не хватает для классического DDD | Aggregate objects, application UoW, единый outbox path |

Рекомендации по gaps: **[architecture-recommendations.md](./architecture-recommendations.md)**.
