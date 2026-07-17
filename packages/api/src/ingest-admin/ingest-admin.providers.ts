/**
 * ---
 * layer: api/composition
 * domain: ingest
 * purpose: Nest composition корня ingest-admin: persistence и transport adapters.
 * ---
 */
import type { Provider } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TypeOrmChannelRepository } from "../infrastructure/persistence/typeorm-channel.repository";
import { TypeOrmDomainEventOutbox, TypeOrmRawMessageRepository } from "../infrastructure/persistence/typeorm-raw-message.repository";
import { TypeOrmIngestBackfillJobRepository } from "../infrastructure/persistence/typeorm-ingest-backfill-job.repository";
import { TypeOrmIngestBindingRepository } from "../infrastructure/persistence/typeorm-ingest-binding.repository";
import { TypeOrmIngestProviderRepository } from "../infrastructure/persistence/typeorm-ingest-provider.repository";
import { createApiDeploymentEventTransport } from "../infrastructure/transport/create-api-deployment-event-transport";
import type { IEventTransport } from "@radar/shared";

export const INGEST_ADMIN_DEPENDENCIES = Symbol("INGEST_ADMIN_DEPENDENCIES");

export type IngestAdminDependencies = {
  dataSource: DataSource;
  providers: TypeOrmIngestProviderRepository;
  bindings: TypeOrmIngestBindingRepository;
  channels: TypeOrmChannelRepository;
  rawMessages: TypeOrmRawMessageRepository;
  outbox: TypeOrmDomainEventOutbox;
  backfillJobs: TypeOrmIngestBackfillJobRepository;
  transport: IEventTransport;
};

/** Собирает единственный набор concrete adapters для ingest admin use-case. */
export const ingestAdminDependenciesProvider: Provider = {
  provide: INGEST_ADMIN_DEPENDENCIES,
  useFactory: (dataSource: DataSource): IngestAdminDependencies => ({
    dataSource,
    providers: new TypeOrmIngestProviderRepository(dataSource),
    bindings: new TypeOrmIngestBindingRepository(dataSource),
    channels: new TypeOrmChannelRepository(dataSource),
    rawMessages: new TypeOrmRawMessageRepository(dataSource),
    outbox: new TypeOrmDomainEventOutbox(dataSource),
    backfillJobs: new TypeOrmIngestBackfillJobRepository(dataSource),
    transport: createApiDeploymentEventTransport(dataSource),
  }),
  inject: [DataSource],
};
