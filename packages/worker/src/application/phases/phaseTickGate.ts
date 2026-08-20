/**
 * Domain policy перед тиком фазы: stale runs + geo ordering (nominatim ждёт dadata).
 * Mill/workbook только вызывают gate — без знания провайдеров внутри evaluate.
 */
import type {
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";

const STALE_RUN_MS = 2 * 60 * 60 * 1000;

export type PhaseTickGateDeps = {
  phaseRuns: IPhaseRunRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
};

export type PhaseTickGateResult = {
  /** true = тик пропускаем (slice empty). */
  skip: boolean;
};

export function createPhaseTickGate(deps: PhaseTickGateDeps) {
  return {
    async beforeTick(phase: PhaseDefinitionRecord): Promise<PhaseTickGateResult> {
      await deps.phaseRuns.failStaleActiveRuns(phase.id, STALE_RUN_MS);

      if (phase.scope !== "geoParse") {
        return { skip: false };
      }

      const provider = resolveGeoEnrichmentProvider(phase);
      if (provider !== "nominatim") {
        return { skip: false };
      }

      const dadata = await deps.placeJobs.countByStatus("dadata");
      if (dadata.pending + dadata.processing > 0) {
        return { skip: true };
      }
      return { skip: false };
    },
  };
}

export type PhaseTickGate = ReturnType<typeof createPhaseTickGate>;
