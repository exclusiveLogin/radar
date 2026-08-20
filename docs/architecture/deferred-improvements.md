# Отложенные архитектурные доработки

Этот backlog содержит подтверждённые точки возможного drift после очистки
cross-package границ. Это не текущие нарушения Clean Architecture или DDD:
каждая задача требует отдельного решения о контракте или политике.

Источник инвентаря: [domain-inventory.md](./domain-inventory.md).

## Приоритет 1 — tracking persistence queries

### Единый запрос оставшейся работы pipeline

**Сейчас:** worker и API admin независимо считают необработанные записи tracking
pipeline. SQL совпадает, но API добавляет retry при PostgreSQL contention, а worker
читает напрямую.

**Риск:** изменение условия «не обработано» или retry-политики может попасть только
в один путь.

**Доработка:** в `@radar/persistence` ввести узкий порт/query для pipeline remaining
count. Перед переносом согласовать retry budget для read-path.

**Не делать:** не переносить `tracking-admin.service` или worker use-case в
persistence package.

### Pipeline state SQL

**Сейчас:** worker repository и API tracking admin оба обращаются к
`state_track_pipeline` и `job_track_rebuild`. API дополнительно обслуживает metrics,
terminate blockers и lite mode.

**Риск:** схема или базовые условия state-machine могут разойтись.

**Доработка:** выделить в `@radar/persistence` отдельные узкие ports для pipeline
state и rebuild jobs. Admin-specific metrics и HTTP boundary оставить в API.

## Приоритет 2 — контракты времени и ingest

### Семантика времени события

**Сейчас:** tracking и map/feed queries используют похожие `COALESCE` для event time.
Tracking учитывает `parsed_at`, map read-model — нет.

**Риск:** одно событие может получить разный порядок в pipeline и UI.

**Доработка:** сначала зафиксировать два именованных контракта:

- `tracking event time` — детерминированный порядок обработки;
- `read-model event time` — порядок отображения карты и ленты.

После этого вынести SQL каждого контракта рядом с его владельцем.

**Не делать:** не создавать единый `EVENT_AT_SQL`: правила сейчас различаются
намеренно.

### Контракт публикации RawMessage events

**Сейчас:** worker live ingest и API manual ingest публикуют один topic/type, но
передают разный контекст: ingest source против ids для phase wake.

**Риск:** новый consumer может считать поле обязательным, хотя оно отсутствует в
другом пути публикации.

**Доработка:** описать обязательную часть payload и допустимые расширения. Только
если она станет одинаковой — ввести shared factory.

## Приоритет 3 — локальная инфраструктурная консистентность

### PostgreSQL retry budgets

**Сейчас:** механизм retry общий, но map, tracking admin и worker используют
разные попытки и задержки.

**Риск:** только неявный drift; это не доказанная ошибка, потому что операции имеют
разные latency и lock budget.

**Доработка:** после появления SLO ввести именованные package-local policy рядом с
read/write владельцем.

**Не делать:** не вводить глобальный `DEFAULT_RETRY`.

### WebSocket reconnect wiring

**Сейчас:** map realtime и admin WebSocket имеют близкую backoff-логику, но
разные URL, schema, state и logging.

**Риск:** изменение reconnect-поведения может не попасть во второй клиент.

**Доработка:** вернуться к этому только при появлении третьего WS consumer; тогда
выделить infrastructure factory с явными URL/schema/status dependencies.

## Намеренно не объединять

Три трёхчасовых окна — visibility спокойных регионов, fade заливки и critical panel —
совпадают численно, но принадлежат разным policy. Общая константа свяжет domain
visibility и presentation без бизнес-основания.

Аналогично не объединять Nominatim backoff, PostgreSQL retry и RMQ publisher retry:
у них разные failure domains.
