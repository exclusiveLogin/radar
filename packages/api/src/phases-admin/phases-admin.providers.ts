/**
 * ---
 * layer: api/composition
 * domain: phases
 * purpose: Nest composition корня phases-admin: persistence и RMQ adapters.
 * ---
 */
import type { Provider } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TypeOrmPhaseCoverageRepository } from "@radar/persistence";
import { TypeOrmPhaseDefinitionRepository } from "@radar/persistence";
import { TypeOrmPhaseRunRepository } from "@radar/persistence";
import { TypeOrmPlaceEnrichmentJobRepository } from "@radar/persistence";
import { createApiDeploymentEventTransport } from "../infrastructure/transport/create-api-deployment-event-transport";
import type { IEventTransport } from "@radar/shared";

export const PHASES_ADMIN_DEPENDENCIES = Symbol("PHASES_ADMIN_DEPENDENCIES");

export type PhasesAdminDependencies = {
  dataSource: DataSource;
  phases: TypeOrmPhaseDefinitionRepository;
  coverage: TypeOrmPhaseCoverageRepository;
  runs: TypeOrmPhaseRunRepository;
  placeJobs: TypeOrmPlaceEnrichmentJobRepository;
  transport: IEventTransport;
};

/** Собирает concrete adapters для phases admin use-case. */
export const phasesAdminDependenciesProvider: Provider = {
  provide: PHASES_ADMIN_DEPENDENCIES,
  useFactory: (dataSource: DataSource): PhasesAdminDependencies => ({
    dataSource,
    phases: new TypeOrmPhaseDefinitionRepository(dataSource),
    coverage: new TypeOrmPhaseCoverageRepository(dataSource),
    runs: new TypeOrmPhaseRunRepository(dataSource),
    placeJobs: new TypeOrmPlaceEnrichmentJobRepository(dataSource),
    transport: createApiDeploymentEventTransport(dataSource),
  }),
  inject: [DataSource],
};
