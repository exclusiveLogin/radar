import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPlaceEnrichmentJobRepository,
  IWorkQueue,
  PhaseCoverageTask,
  PhaseDefinitionRecord,
  PhaseTriggerMode,
  PlaceEnrichmentJobRecord,
  WorkItemResult,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../geo-parse/placeEnrichmentRunner.js";
import { prerequisitePhaseIds } from "../phases/phaseOrder.js";
import type { PhaseRunner } from "../phases/phaseRunner.js";
import { createGeoPlaceQueue } from "../phases/geoPlaceQueue.js";
import { createParsePhaseQueue } from "../phases/parsePhaseQueue.js";
import type { ScheduleMode } from "../runtime/runner-platform/runnerContracts.js";

export type PhaseDriverDeps = {
  phases: IPhaseDefinitionRepository;
  coverage: IPhaseCoverageRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  runner: PhaseRunner;
  placeEnrichmentRunner?: PlaceEnrichmentRunner;
};

export type PhaseDriverSchedule = {
  mode: ScheduleMode;
  intervalMs?: number;
};

/** SSOT-артефакт фазы: очередь + domain eval + политика тиков. */
export type PhaseDriver<TWorkItem> = {
  queue: IWorkQueue<TWorkItem>;
  runItem: (item: TWorkItem) => Promise<WorkItemResult>;
  schedule: PhaseDriverSchedule;
};

/** triggerMode фазы → ScheduleMode workload (RMQ wake ортогонален, см. phaseWakeScheduler). */
export function triggerModeToSchedule(
  triggerMode: PhaseTriggerMode | undefined,
  intervalMs: number,
): PhaseDriverSchedule {
  const mode = triggerMode ?? "both";
  if (mode === "timeout") return { mode: "interval", intervalMs };
  if (mode === "both") return { mode: "hybrid", intervalMs };
  // event | manual — только wake/enqueue, без interval watchdog
  return { mode: "event" };
}

function resolveIntervalMs(phase: PhaseDefinitionRecord): number {
  return Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
}

/** Фабрика домена по scope phase_definitions. */
export async function buildPhaseDriver(
  phase: PhaseDefinitionRecord,
  deps: PhaseDriverDeps,
): Promise<PhaseDriver<PhaseCoverageTask | PlaceEnrichmentJobRecord>> {
  const schedule = triggerModeToSchedule(phase.triggerMode, resolveIntervalMs(phase));

  if (phase.scope === "ingestParse") {
    const enabledPhases = await deps.phases.listEnabled(undefined, "ingestParse");
    const queue = createParsePhaseQueue({
      coverage: deps.coverage,
      phaseId: phase.id,
      prerequisitePhaseIds: prerequisitePhaseIds(phase, enabledPhases),
    });
    return {
      queue,
      schedule,
      runItem: async (task) => {
        try {
          await deps.runner.handleParseTask(phase, task as PhaseCoverageTask);
          return { outcome: "completed" as const };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return { outcome: "failed" as const, detail };
        }
      },
    };
  }

  const provider = resolveGeoEnrichmentProvider(phase);
  const enrichmentRunner = deps.placeEnrichmentRunner;
  if (!provider || !enrichmentRunner) {
    throw new Error(`geo phase ${phase.id}: runner/provider missing`);
  }
  const queue = createGeoPlaceQueue({ placeJobs: deps.placeJobs, provider });
  return {
    queue,
    schedule,
    runItem: (job) =>
      enrichmentRunner.processClaimedJob(provider, job as PlaceEnrichmentJobRecord),
  };
}
