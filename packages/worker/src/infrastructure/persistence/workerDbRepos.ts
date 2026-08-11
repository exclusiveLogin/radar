import type { DataSource } from "typeorm";
import {
  TypeOrmChannelRepository,
  TypeOrmDomainEventRepository,
  TypeOrmEnrichmentQueueRepository,
  TypeOrmEventEvidenceRepository,
  TypeOrmEventLocationRepository,
  TypeOrmIngestBackfillJobRepository,
  TypeOrmIngestBindingRepository,
  TypeOrmIngestCursorRepository,
  TypeOrmIngestProviderRepository,
  TypeOrmMessageParseWorkspaceRepository,
  TypeOrmParseAttemptRepository,
  TypeOrmParsedEventRepository,
  TypeOrmPhaseCoverageRepository,
  TypeOrmPhaseDefinitionRepository,
  TypeOrmPhaseRunRepository,
  TypeOrmPlaceAliasRepository,
  TypeOrmPlaceEnrichmentJobRepository,
  TypeOrmPlaceRepository,
  TypeOrmPipelineStabilityRepository,
  TypeOrmRawMessageRepository,
  TypeOrmRegionRepository,
  TypeOrmStatusDictionaryRepository,
} from "@radar/persistence";
import type { WorkerDbRepositories } from "./workerDbRepos.types.js";

/** TypeORM-репозитории общего persistence package. */
export async function createWorkerDbRepositories(
  dataSource: DataSource,
): Promise<WorkerDbRepositories> {
  return {
    rawMessages: new TypeOrmRawMessageRepository(dataSource),
    parsedEvents: new TypeOrmParsedEventRepository(dataSource),
    messageParseWorkspaces: new TypeOrmMessageParseWorkspaceRepository(dataSource),
    eventLocations: new TypeOrmEventLocationRepository(dataSource),
    eventEvidence: new TypeOrmEventEvidenceRepository(dataSource),
    regions: new TypeOrmRegionRepository(dataSource),
    places: new TypeOrmPlaceRepository(dataSource),
    aliases: new TypeOrmPlaceAliasRepository(dataSource),
    placeEnrichmentJobs: new TypeOrmPlaceEnrichmentJobRepository(dataSource),
    cursors: new TypeOrmIngestCursorRepository(dataSource),
    ingestProviders: new TypeOrmIngestProviderRepository(dataSource),
    ingestBindings: new TypeOrmIngestBindingRepository(dataSource),
    channels: new TypeOrmChannelRepository(dataSource),
    backfillJobs: new TypeOrmIngestBackfillJobRepository(dataSource),
    statusDictionary: new TypeOrmStatusDictionaryRepository(dataSource),
    domainEvents: new TypeOrmDomainEventRepository(dataSource),
    parseAttempts: new TypeOrmParseAttemptRepository(dataSource),
    phaseCoverage: new TypeOrmPhaseCoverageRepository(dataSource),
    enrichmentQueue: new TypeOrmEnrichmentQueueRepository(dataSource),
    phaseDefinitions: new TypeOrmPhaseDefinitionRepository(dataSource),
    phaseRuns: new TypeOrmPhaseRunRepository(dataSource),
    pipelineStability: new TypeOrmPipelineStabilityRepository(dataSource),
  };
}

export type { WorkerDbRepositories } from "./workerDbRepos.types.js";
