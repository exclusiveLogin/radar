/**
 * Type-only public barrel for domain ports.
 * Runtime exports are intentionally absent.
 */
export type { IGeoSourceProvider, GeoProviderSnapshot } from "./providers";
export type { ILocationEnricher, LocationCandidate, LocationEnrichInput } from "./enrichers";
export type { IEventClassifier, ClassifiedPost } from "./classifiers";
export type { EventHandler, IEventPublisher, IEventSubscriber, Unsubscribe } from "./events";
export type {
  IEventTransport,
  TransportDelivery,
  TransportEventHandler,
  TransportSignalHandler,
  TransportSubscribeOptions,
} from "./eventTransport";
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
  ChannelHistoryBounds,
  TelegramMtprotoAppCredentials,
} from "./ingest-adapters";
export type {
  ISessionRuntimeStore,
  ISessionBootstrapService,
} from "./session-store";
export type {
  ILlmChatClient,
  LlmChatMessage,
  LlmChatOptions,
  LlmChatResult,
  LlmChatRole,
} from "./llmChatClient";
export type {
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
  ChannelRecord,
  IRawMessageRepository,
  IParsedEventRepository,
  ParsedEventRecord,
  IMessageParseWorkspaceRepository,
  MessageParseWorkspaceRecord,
  EventEvidenceRecord,
  IEventEvidenceRepository,
} from "./ingest-repositories";
export type {
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceRepository,
  IRegionRepository,
  IStatusDictionaryRepository,
  ISyncAuditRepository,
  PlaceAliasRecord,
  PlaceCacheHit,
  PlaceCacheProvider,
  PlaceCachePutMeta,
  PlaceContribution,
  PlaceProvider,
  PlaceRecord,
  RegionRecord,
  StatusDictionaryRecord,
  IPlaceEnrichmentJobRepository,
  PlaceEnrichmentJobRecord,
  PlaceEnrichmentProvider,
} from "./geo-repositories";
export type {
  IEnrichmentQueueRepository,
  IPhaseCoverageRepository,
  PhaseCoverageTask,
  PhaseCoverageStatus,
  IPhaseRunRepository,
  PhaseRunFilter,
  EnrichmentTask,
  EnrichmentTaskStatus,
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
} from "./phase-repositories";
export type { IDomainEventRepository } from "./event-repositories";
export type { IObservabilityRecorder } from "./observability-recorder";
