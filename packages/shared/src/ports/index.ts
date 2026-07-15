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
  ParsedEventRecord,
  IMessageParseWorkspaceRepository,
  MessageParseWorkspaceRecord,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionRepository,
  IStatusDictionaryRepository,
  ISyncAuditRepository,
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
  ChannelRecord,
  PlaceAliasRecord,
  PlaceCacheHit,
  PlaceCacheProvider,
  PlaceCachePutMeta,
  PlaceContribution,
  PlaceProvider,
  PlaceRecord,
  RegionRecord,
  StatusDictionaryRecord,
} from "./repositories";
export type { IObservabilityRecorder } from "./observability-recorder";
