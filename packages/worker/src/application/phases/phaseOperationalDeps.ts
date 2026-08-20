import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
} from "@radar/shared";
import type { OperationalSql } from "./operationalSql.port.js";

/** Узкие зависимости операций жизненного цикла parse/geo фаз. */
export type PhaseOperationalDeps = {
  operationalSql: OperationalSql;
  phaseCoverage: IPhaseCoverageRepository;
  phaseDefinitions: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  placeEnrichmentJobs: IPlaceEnrichmentJobRepository;
};

/** Проецирует persistence composition на зависимости phase lifecycle use cases. */
export function createPhaseOperationalDeps(
  operationalSql: OperationalSql,
  repos: Omit<PhaseOperationalDeps, "operationalSql">,
): PhaseOperationalDeps {
  return { operationalSql, ...repos };
}
