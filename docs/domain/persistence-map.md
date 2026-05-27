# Карта persistence

## Зачем

Связать ORM entity, доменные типы в shared и порты — чтобы из `*.entity.ts` понимать роль строки.

В коде у каждой entity в JSDoc: **роль в продукте** (что даёт пользователю/пайплайну) и **зачем отдельная таблица** — не пересказ имени класса.

## Как читать

- **Entity** — TypeORM, пакет `packages/api`
- **Shared type** — контракт use case (если есть отдельный тип)
- **Port** — интерфейс в `packages/shared/src/ports/repositories.ts`

---

## Ingest Acquisition

| Entity | Таблица | Shared / домен | Port |
|--------|---------|----------------|------|
| `ChannelEntity` {#ChannelEntity} | `channels` | channel key в `RawMessage` | `IChannelRepository` |
| `RawMessageEntity` {#RawMessageEntity} | `raw_messages` | `RawMessage` | `IRawMessageRepository` |
| `RawMessageTelegramEntity` {#RawMessageTelegramEntity} | `raw_message_telegram` | `RawMessageTelegramExtension` | `IRawMessageTelegramExtensionRepository` |
| `IngestProviderEntity` {#IngestProviderEntity} | `ingest_providers` | `IngestProviderRecord` | `IIngestProviderRepository` |
| `IngestBindingEntity` {#IngestBindingEntity} | `ingest_bindings` | `IngestBindingRecord` | `IIngestBindingRepository` |
| `IngestCursorEntity` {#IngestCursorEntity} | `ingest_cursors` | — | `IIngestCursorRepository` |
| `IngestBackfillJobEntity` {#IngestBackfillJobEntity} | `ingest_backfill_jobs` | `BackfillJobRecord` | `IIngestBackfillJobRepository` |

Контекст: [contexts/ingest.md](./contexts/ingest.md).

---

## Signal Processing / Events

| Entity | Таблица | Shared | Port |
|--------|---------|--------|------|
| `ParsedEventEntity` {#ParsedEventEntity} | `parsed_events` | `ParsedEvent` | `IParsedEventRepository` |
| `EventLocationEntity` {#EventLocationEntity} | `event_locations` | `EventLocation` | `IEventLocationRepository` |
| `ParseAttemptEntity` {#ParseAttemptEntity} | `parse_attempts` | — | (логирование) |
| `DomainEventEntity` {#DomainEventEntity} | `domain_events` | `DomainEvent` | `IDomainEventRepository` |
| `PlaceCacheEntity` {#PlaceCacheEntity} | `place_cache` | cache hit types | `IPlaceCacheRepository` |
| `StatusDictionaryEntity` {#StatusDictionaryEntity} | `status_dictionary` | `StatusDictionaryRecord` | `IStatusDictionaryRepository` |
| `PlaceStatusActiveEntity` {#PlaceStatusActiveEntity} | `place_status_active` | `PlaceStatusActiveRecord` | `IPlaceStatusRepository` |
| `PlaceStatusHistoryEntity` {#PlaceStatusHistoryEntity} | `place_status_history` | history record | `IPlaceStatusHistoryRepository` |
| `EventSubscriptionEntity` {#EventSubscriptionEntity} | `event_subscriptions` | — | (read/notifications) |

---

## Geo / Place

| Entity | Таблица | Shared | Port |
|--------|---------|--------|------|
| `RegionEntity` {#RegionEntity} | `regions` | `RegionRecord` | `IRegionRepository` |
| `PlaceEntity` {#PlaceEntity} | `places` | `PlaceRecord` | `IPlaceRepository` |
| `PlaceAliasEntity` {#PlaceAliasEntity} | `place_aliases` | `PlaceAliasRecord` | `IPlaceAliasRepository` |
| `PlaceEvidenceEntity` {#PlaceEvidenceEntity} | `place_evidence` | `PlaceEvidenceRecord` | `IPlaceEvidenceRepository` |
| `GeoSyncLogEntity` {#GeoSyncLogEntity} | `geo_sync_log` | audit payload | `ISyncAuditRepository` |

Контекст: [contexts/geo-place.md](./contexts/geo-place.md), [docs/geo-dataset-schemas.md](../geo-dataset-schemas.md).

---

## Маппинг в коде

| Область | Mapper / repository |
|---------|---------------------|
| Ingest | `ingest-mappers.ts`, `typeorm-raw-message.repository.ts` |
| Parsed | `typeorm-parsed-event.repository.ts` |
| Place | `typeorm-place.repository.ts` (`toRecord`, `toEntity`) |

Entity-файлы: `packages/api/src/**/entities/*.entity.ts`.

## FAQ

**Почему entity в api, а не в shared?**  
TypeORM привязан к Nest/API; shared остаётся без фреймворка.

**Где бизнес-логика place?**  
`mergePlaceContribution` в shared, вызов из `TypeOrmPlaceRepository.mergeContribution` и `GeoValidationService`.
