import {
  DomainEventEntity,
  EnrichmentQueueEntity,
  EventEvidenceEntity,
  EventLocationEntity,
  EventSubscriptionEntity,
  JobParsePhaseEntity,
  ParseAttemptEntity,
  ParsedEventEntity,
  PhaseDefinitionEntity,
  PhaseRunEntity,
  PlaceEnrichmentJobEntity,
  StatusDictionaryEntity,
} from "./events";
import {
  GeoFeatureEntity,
  GeoSyncLogEntity,
  PlaceAliasEntity,
  PlaceEntity,
  PlaceGeoLinkEntity,
  RegionEntity,
} from "./geo";
import {
  ChannelEntity,
  IngestBackfillJobEntity,
  IngestBindingEntity,
  IngestCursorEntity,
  IngestProviderEntity,
  RawMessageEntity,
  RawMessageTelegramEntity,
} from "./ingest";
import {
  ObsExecutorEntity,
  ObsHostEntity,
  ObsMaterializeCounterEntity,
  ObsTriggerCounterEntity,
  ObsWorkloadEntity,
  PipelineStabilityEntity,
} from "./observability";


/** Единый набор TypeORM entity для автономных DataSource API и worker. */
export const typeOrmEntities = [
  ChannelEntity,
  DomainEventEntity,
  EnrichmentQueueEntity,
  EventEvidenceEntity,
  EventLocationEntity,
  EventSubscriptionEntity,
  GeoFeatureEntity,
  GeoSyncLogEntity,
  IngestBackfillJobEntity,
  IngestBindingEntity,
  IngestCursorEntity,
  IngestProviderEntity,
  JobParsePhaseEntity,
  ObsExecutorEntity,
  ObsHostEntity,
  ObsMaterializeCounterEntity,
  ObsTriggerCounterEntity,
  ObsWorkloadEntity,
  PipelineStabilityEntity,
  ParseAttemptEntity,
  ParsedEventEntity,
  PhaseDefinitionEntity,
  PhaseRunEntity,
  PlaceAliasEntity,
  PlaceEntity,
  PlaceEnrichmentJobEntity,
  PlaceGeoLinkEntity,
  RawMessageEntity,
  RawMessageTelegramEntity,
  RegionEntity,
  StatusDictionaryEntity,
];

export * from "./events";
export * from "./geo";
export * from "./ingest";
export * from "./observability";
