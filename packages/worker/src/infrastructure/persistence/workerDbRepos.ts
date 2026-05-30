import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DataSource } from "typeorm";
import type { ApiPersistenceModule, WorkerDbRepositories } from "./workerDbRepos.types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function resolveApiPersistenceImport(): string {
  const dist = path.resolve(
    here,
    "../../../../api/dist/infrastructure/persistence/index.js",
  );
  if (fs.existsSync(dist)) {
    return dist;
  }
  return path.resolve(
    here,
    "../../../../api/src/infrastructure/persistence/index.js",
  );
}

/** TypeORM repos из API persistence (runtime import, без Nest DI). */
export async function createWorkerDbRepositories(
  dataSource: DataSource,
): Promise<WorkerDbRepositories> {
  const persistence = (await import(
    pathToFileURL(resolveApiPersistenceImport()).href,
  )) as ApiPersistenceModule;

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
    backfillJobs: new persistence.TypeOrmIngestBackfillJobRepository(dataSource),
    regionState: new persistence.TypeOrmRegionStateRepository(dataSource),
    placeStatus: new persistence.TypeOrmPlaceStatusRepository(dataSource),
    statusDictionary: new persistence.TypeOrmStatusDictionaryRepository(dataSource),
    domainEvents: new persistence.TypeOrmDomainEventRepository(dataSource),
  };
}

export type { WorkerDbRepositories } from "./workerDbRepos.types.js";
