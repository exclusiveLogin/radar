import type { DataSource } from "typeorm";
import type { IEventPublisher } from "@radar/shared";
import type {
  IChannelRepository,
  IDomainEventRepository,
  IEnrichmentQueueRepository,
  IEventLocationRepository,
  IIngestBackfillJobRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IParseAttemptRepository,
  IParsedEventRepository,
  IPlaceAliasRepository,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  IPlaceStatusRepository,
  IRawMessageRepository,
  IRegionRepository,
  IRegionStateRepository,
  IStatusDictionaryRepository,
} from "@radar/shared";

export type WorkerDbRepositories = {
  rawMessages: IRawMessageRepository;
  parsedEvents: IParsedEventRepository;
  eventLocations: IEventLocationRepository;
  regions: IRegionRepository;
  places: IPlaceRepository;
  aliases: IPlaceAliasRepository;
  placeEvidence: IPlaceEvidenceRepository;
  cursors: IIngestCursorRepository;
  ingestProviders: IIngestProviderRepository;
  ingestBindings: IIngestBindingRepository;
  channels: IChannelRepository;
  backfillJobs: IIngestBackfillJobRepository;
  regionState: IRegionStateRepository;
  placeStatus: IPlaceStatusRepository;
  statusDictionary: IStatusDictionaryRepository;
  domainEvents: IDomainEventRepository;
  parseAttempts: IParseAttemptRepository;
  enrichmentQueue: IEnrichmentQueueRepository;
};

/** Structural typing для runtime import API persistence (без компиляции api в worker). */
export type ApiPersistenceModule = {
  TypeOrmRawMessageRepository: new (dataSource: DataSource) => IRawMessageRepository;
  TypeOrmParsedEventRepository: new (dataSource: DataSource) => IParsedEventRepository;
  TypeOrmEventLocationRepository: new (dataSource: DataSource) => IEventLocationRepository;
  TypeOrmRegionRepository: new (dataSource: DataSource) => IRegionRepository;
  TypeOrmPlaceRepository: new (dataSource: DataSource) => IPlaceRepository;
  TypeOrmPlaceAliasRepository: new (dataSource: DataSource) => IPlaceAliasRepository;
  TypeOrmPlaceEvidenceRepository: new (dataSource: DataSource) => IPlaceEvidenceRepository;
  TypeOrmIngestCursorRepository: new (dataSource: DataSource) => IIngestCursorRepository;
  TypeOrmIngestProviderRepository: new (dataSource: DataSource) => IIngestProviderRepository;
  TypeOrmIngestBindingRepository: new (dataSource: DataSource) => IIngestBindingRepository;
  TypeOrmChannelRepository: new (dataSource: DataSource) => IChannelRepository;
  TypeOrmIngestBackfillJobRepository: new (dataSource: DataSource) => IIngestBackfillJobRepository;
  TypeOrmRegionStateRepository: new (dataSource: DataSource) => IRegionStateRepository;
  TypeOrmPlaceStatusRepository: new (dataSource: DataSource) => IPlaceStatusRepository;
  TypeOrmStatusDictionaryRepository: new (dataSource: DataSource) => IStatusDictionaryRepository;
  TypeOrmDomainEventRepository: new (dataSource: DataSource) => IDomainEventRepository;
  TypeOrmParseAttemptRepository: new (dataSource: DataSource) => IParseAttemptRepository;
  TypeOrmEnrichmentQueueRepository: new (
    dataSource: DataSource,
  ) => IEnrichmentQueueRepository;
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
