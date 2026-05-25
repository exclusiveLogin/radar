import type { DataSource } from "typeorm";
import type { ApiPersistenceModule, WorkerDbRepositories } from "./workerDbRepos.types.js";

/** TypeORM repos из API persistence (runtime import, без Nest DI). */
export async function createWorkerDbRepositories(
  dataSource: DataSource,
): Promise<WorkerDbRepositories> {
  const persistencePath = ["..", "..", "..", "..", "api", "src", "infrastructure", "persistence", "index.js"].join(
    "/",
  );
  const persistence = (await import(persistencePath)) as ApiPersistenceModule;

  return {
    rawMessages: new persistence.TypeOrmRawMessageRepository(dataSource),
    parsedEvents: new persistence.TypeOrmParsedEventRepository(dataSource),
    eventLocations: new persistence.TypeOrmEventLocationRepository(dataSource),
    regions: new persistence.TypeOrmRegionRepository(dataSource),
    places: new persistence.TypeOrmPlaceRepository(dataSource),
    aliases: new persistence.TypeOrmPlaceAliasRepository(dataSource),
    placeEvidence: new persistence.TypeOrmPlaceEvidenceRepository(dataSource),
    cursors: new persistence.TypeOrmIngestCursorRepository(dataSource),
    ingestProviders: new persistence.TypeOrmIngestProviderRepository(dataSource),
    ingestBindings: new persistence.TypeOrmIngestBindingRepository(dataSource),
    channels: new persistence.TypeOrmChannelRepository(dataSource),
  };
}

export type { WorkerDbRepositories } from "./workerDbRepos.types.js";
