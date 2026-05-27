# Контекст: Ingest Acquisition

## Зачем

Детализация dedup, cursor и событий ingest — дополнение к [how-it-works.md#ingest-flow](../how-it-works.md#ingest-flow).

## Как работает dedup

Порядок в `TypeOrmRawMessageRepository.upsert`:

1. **Hash** — `findOne({ hash })` → duplicate, вернуть существующий id.
2. **Channel** — resolve `channelKey` → `channels.id`.
3. **Identity** — `(channelId, providerKey, externalMessageId, revisionKey)` → duplicate.
4. **Telegram** — при extension: UNIQUE `(chat_id, message_id, edit_date)` через `findDuplicate`.
5. **Insert** — TX: `raw_messages` + `raw_message_telegram`.

Hash вычисляется в handler: `ingestMessageHash()` из shared.

## Cursor (live)

- Обновляется только если `ingestMode === "live"` в `advanceLive`.
- Handler вызывает cursor только при `result.inserted && ingestMode === "live"`.
- Backfill **не** двигает live cursor (инвариант из ingest-providers).

Файл: `typeorm-ingest-cursor.repository.ts`.

## События

| Результат upsert | type | Parse запускается? |
|------------------|------|-------------------|
| insert | `RawMessageIngested` | Да (subscriber) |
| duplicate | `RawMessageDuplicate` | Нет |

Worker: `events.publish` → bus.  
Admin manual ingest: `outbox.append` → позже relay → bus.

## Orchestrator

- `IngestOrchestrator.start` — live adapters → `ingestHandler.handle` на каждое сообщение.
- Ошибка duty → `IngestSourceUnavailable`, `aggregateType: ingest_provider`.
- `runBackfillChunk` — **CLI chunk** (одна пачка); событие `IngestBackfillChunkCompleted` на `ingest_binding`.

## Backfill V2 (демон)

- `BackfillDaemonService` — poll `ingest_backfill_jobs`, `adapter.streamHistory`, чекпоинт после каждого сообщения.
- Схемы и runbook: **[docs/backfill-v2-pipeline.md](../../backfill-v2-pipeline.md)**.

## Где в коде

| Файл |
|------|
| `packages/worker/.../ingestRawMessageHandler.ts` |
| `packages/worker/.../ingestOrchestrator.ts` |
| `packages/api/.../typeorm-raw-message.repository.ts` |
| `packages/api/.../ingest-admin.service.ts` |

Полные инварианты: **[docs/ingest-providers.md](../../ingest-providers.md)**.

## FAQ

**`IngestCursorAdvanced` в enum?**  
Тип в схеме есть, publish в коде не найден — см. [validation-report.md](../validation-report.md).
