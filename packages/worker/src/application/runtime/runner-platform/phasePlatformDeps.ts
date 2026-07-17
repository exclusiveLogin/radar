/**
 * SSOT projection deps для PhaseDriver / UnifiedPhaseWorkload / PhaseKindRunnerRegistry.
 * Composition собирает порты; mill получает только queue+handle через PhaseDriver.
 */
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
} from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../../geo-parse/placeEnrichmentRunner.js";
import type { ParsePhaseTool } from "../../parse/parsePhaseTool.js";
import type { PhaseRunSession } from "../../phases/phaseRunSession.js";
import type { WorkloadObsContext } from "../observability/workloadObsHooks.js";

/** Порты platform phase pipelines (parse + geo) — без WorkerDbRepositories bag. */
export type PhasePlatformDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  /** Obs/control session для log_phase_run. */
  session: PhaseRunSession;
  /** Domain-инструмент parse; нужен для ingestParse scope. */
  parseTool?: ParsePhaseTool;
  /** Domain-инструмент geo; нужен для geoParse scope. */
  placeEnrichmentRunner?: PlaceEnrichmentRunner;
  obs?: WorkloadObsContext;
};
