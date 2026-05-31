/**
 * Type-only public barrel for domain ports.
 * Runtime exports are intentionally absent.
 */
export type { IGeoSourceProvider, GeoProviderSnapshot } from "./providers";
export type { ILocationEnricher, LocationCandidate } from "./enrichers";
export type { IEventClassifier, ClassifiedPost } from "./classifiers";
export type { EventHandler, IEventPublisher, IEventSubscriber, Unsubscribe } from "./events";
export type {
  ISourceUniquenessContributor,
} from "./source-uniqueness";
export { SourceUniquenessRegistry } from "./source-uniqueness";
export type {
  IngestNormalizedMessage,
  IngestAdapterHealth,
  IngestAdapterContext,
  IngestMessageSink,
  IRawIngestAdapter,
  StreamHistoryParams,
  TelegramMtprotoAppCredentials,
} from "./ingest-adapters";
export type {
  ISessionRuntimeStore,
  ISessionBootstrapService,
} from "./session-store";
export type {
  IDomainEventRepository,
  IDomainEventOutbox,
  IEventLocationRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IIngestBindingRepository,
  IIngestBackfillJobRepository,
  BackfillJobFilter,
  IParseAttemptRepository,
  ParseAttemptInput,
  IRawMessageTelegramExtensionRepository,
  IChannelRepository,
  IParsedEventRepository,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  IPlaceStatusHistoryRepository,
  IPlaceStatusRepository,
  IRegionStateRepository,
  IRawMessageRepository,
  IRegionRepository,
  IStatusDictionaryRepository,
  ISyncAuditRepository,
  ChannelRecord,
  PlaceStatusActiveRecord,
  PlaceStatusHistoryRecord,
  RegionStateActiveRecord,
  PlaceAliasRecord,
  PlaceCacheHit,
  PlaceCacheProvider,
  PlaceCachePutMeta,
  PlaceContribution,
  PlaceEvidenceRecord,
  PlaceProvider,
  PlaceRecord,
  RegionRecord,
  StatusDictionaryRecord,
} from "./repositories";
