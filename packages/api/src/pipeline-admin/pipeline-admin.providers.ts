/**
 * ---
 * layer: api/composition
 * domain: pipeline
 * purpose: Nest composition: transport + phase repos для pipeline-admin.
 * ---
 */
import type { Provider } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TypeOrmPhaseCoverageRepository } from "@radar/persistence";
import { TypeOrmPhaseDefinitionRepository } from "@radar/persistence";
import { TypeOrmPlaceEnrichmentJobRepository } from "@radar/persistence";
import { createApiDeploymentEventTransport } from "../infrastructure/transport/create-api-deployment-event-transport";
import type { IEventTransport } from "@radar/shared";

export const PIPELINE_ADMIN_DEPENDENCIES = Symbol("PIPELINE_ADMIN_DEPENDENCIES");

export type PipelineAdminDependencies = {
  dataSource: DataSource;
  phases: TypeOrmPhaseDefinitionRepository;
  coverage: TypeOrmPhaseCoverageRepository;
  placeJobs: TypeOrmPlaceEnrichmentJobRepository;
  transport: IEventTransport;
};

export const pipelineAdminDependenciesProvider: Provider = {
  provide: PIPELINE_ADMIN_DEPENDENCIES,
  useFactory: (dataSource: DataSource): PipelineAdminDependencies => ({
    dataSource,
    phases: new TypeOrmPhaseDefinitionRepository(dataSource),
    coverage: new TypeOrmPhaseCoverageRepository(dataSource),
    placeJobs: new TypeOrmPlaceEnrichmentJobRepository(dataSource),
    transport: createApiDeploymentEventTransport(dataSource),
  }),
  inject: [DataSource],
};
