import type {
  IChannelRepository,
  IDomainEventRepository,
  IEnrichmentQueueRepository,
  IPhaseCoverageRepository,
  IPhaseRunRepository,
  IEventLocationRepository,
  IEventEvidenceRepository,
  IIngestBackfillJobRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IMessageParseWorkspaceRepository,
  IParseAttemptRepository,
  IParsedEventRepository,
  IPhaseDefinitionRepository,
  IPlaceAliasRepository,
  IPlaceEnrichmentJobRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionRepository,
  IStatusDictionaryRepository,
} from "@radar/shared";

export type WorkerDbRepositories = {
  rawMessages: IRawMessageRepository;
  parsedEvents: IParsedEventRepository;
  messageParseWorkspaces: IMessageParseWorkspaceRepository;
  eventLocations: IEventLocationRepository;
  eventEvidence: IEventEvidenceRepository;
  regions: IRegionRepository;
  places: IPlaceRepository;
  aliases: IPlaceAliasRepository;
  placeEnrichmentJobs: IPlaceEnrichmentJobRepository;
  cursors: IIngestCursorRepository;
  ingestProviders: IIngestProviderRepository;
  ingestBindings: IIngestBindingRepository;
  channels: IChannelRepository;
  backfillJobs: IIngestBackfillJobRepository;
  statusDictionary: IStatusDictionaryRepository;
  domainEvents: IDomainEventRepository;
  parseAttempts: IParseAttemptRepository;
  /** @deprecated Используйте phaseCoverage */
  enrichmentQueue: IEnrichmentQueueRepository;
  phaseCoverage: IPhaseCoverageRepository;
  phaseDefinitions: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
};
