/**
 * ---
 * layer: api/composition
 * domain: ingest
 * purpose: Nest composition корня ingest-admin: persistence и transport adapters.
 * ---
 */
import type { Provider } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TypeOrmChannelRepository } from "@radar/persistence";
import { TypeOrmRawMessageRepository } from "@radar/persistence";
import { TypeOrmIngestBackfillJobRepository } from "@radar/persistence";
import { TypeOrmIngestBindingRepository } from "@radar/persistence";
import { TypeOrmIngestProviderRepository } from "@radar/persistence";
import { createApiDeploymentEventTransport } from "../infrastructure/transport/create-api-deployment-event-transport";
import type { IEventTransport } from "@radar/shared";

export const INGEST_ADMIN_DEPENDENCIES = Symbol("INGEST_ADMIN_DEPENDENCIES");

export type IngestAdminDependencies = {
  dataSource: DataSource;
  providers: TypeOrmIngestProviderRepository;
  bindings: TypeOrmIngestBindingRepository;
  channels: TypeOrmChannelRepository;
  rawMessages: TypeOrmRawMessageRepository;
  backfillJobs: TypeOrmIngestBackfillJobRepository;
  transport: IEventTransport;
};

/** Собирает единственный набор concrete adapters для ingest admin use-case. */
export const ingestAdminDependenciesProvider: Provider = {
  provide: INGEST_ADMIN_DEPENDENCIES,
  useFactory: (dataSource: DataSource): IngestAdminDependencies => {
    const transport = createApiDeploymentEventTransport(dataSource);
    return {
      dataSource,
      providers: new TypeOrmIngestProviderRepository(dataSource),
      bindings: new TypeOrmIngestBindingRepository(dataSource),
      channels: new TypeOrmChannelRepository(dataSource),
      rawMessages: new TypeOrmRawMessageRepository(dataSource),
      backfillJobs: new TypeOrmIngestBackfillJobRepository(dataSource),
      transport,
    };
  },
  inject: [DataSource],
};
