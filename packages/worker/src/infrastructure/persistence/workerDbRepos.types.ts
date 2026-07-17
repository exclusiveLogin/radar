import type { DataSource } from "typeorm";
import type { IEventPublisher } from "@radar/shared";
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

/** Structural typing для runtime import API persistence (без компиляции api в worker). */
export type ApiPersistenceModule = {
  TypeOrmRawMessageRepository: new (dataSource: DataSource) => IRawMessageRepository;
  TypeOrmParsedEventRepository: new (dataSource: DataSource) => IParsedEventRepository;
  TypeOrmMessageParseWorkspaceRepository: new (
    dataSource: DataSource,
  ) => IMessageParseWorkspaceRepository;
  TypeOrmEventLocationRepository: new (dataSource: DataSource) => IEventLocationRepository;
  TypeOrmRegionRepository: new (dataSource: DataSource) => IRegionRepository;
  TypeOrmPlaceRepository: new (dataSource: DataSource) => IPlaceRepository;
  TypeOrmPlaceAliasRepository: new (dataSource: DataSource) => IPlaceAliasRepository;
  TypeOrmPlaceEnrichmentJobRepository: new (
    dataSource: DataSource,
  ) => IPlaceEnrichmentJobRepository;
  TypeOrmEventEvidenceRepository: new (dataSource: DataSource) => IEventEvidenceRepository;
  TypeOrmIngestCursorRepository: new (dataSource: DataSource) => IIngestCursorRepository;
  TypeOrmIngestProviderRepository: new (dataSource: DataSource) => IIngestProviderRepository;
  TypeOrmIngestBindingRepository: new (dataSource: DataSource) => IIngestBindingRepository;
  TypeOrmChannelRepository: new (dataSource: DataSource) => IChannelRepository;
  TypeOrmIngestBackfillJobRepository: new (dataSource: DataSource) => IIngestBackfillJobRepository;
  TypeOrmStatusDictionaryRepository: new (dataSource: DataSource) => IStatusDictionaryRepository;
  TypeOrmDomainEventRepository: new (dataSource: DataSource) => IDomainEventRepository;
  TypeOrmParseAttemptRepository: new (dataSource: DataSource) => IParseAttemptRepository;
  TypeOrmPhaseCoverageRepository: new (dataSource: DataSource) => IPhaseCoverageRepository;
  TypeOrmEnrichmentQueueRepository: new (dataSource: DataSource) => IEnrichmentQueueRepository;
  TypeOrmPhaseDefinitionRepository: new (
    dataSource: DataSource,
  ) => IPhaseDefinitionRepository;
  TypeOrmPhaseRunRepository: new (dataSource: DataSource) => IPhaseRunRepository;
};

export type ApiOutboxModule = {
  OutboxRelay: new (
    dataSource: DataSource,
    bus: IEventPublisher,
    pollMs?: number,
  ) => {
    start(): void;
    stop(): void;
    tick(): Promise<void>;
  };
};
