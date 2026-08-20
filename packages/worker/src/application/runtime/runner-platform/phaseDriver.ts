/**
 * Фабрика PhaseDriver: scope → queue + runItem + schedule.
 * Не знает PhaseRunner — только parseTool / PlaceEnrichmentRunner из PhasePlatformDeps.
 */
import type {
  IWorkQueue,
  PhaseCoverageTask,
  PhaseDefinitionRecord,
  PlaceEnrichmentJobRecord,
  WorkItemResult,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import { prerequisitePhaseIds } from "../../phases/phaseOrder.js";
import { createGeoPlaceQueue } from "../ports/geoPlaceQueue.js";
import { createParsePhaseQueue } from "../ports/parsePhaseQueue.js";
import type { PhasePlatformDeps } from "./phasePlatformDeps.js";
import type { ScheduleMode } from "./runnerContracts.js";

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

/** Фабрика домена по scope phase_definitions. */
export async function buildPhaseDriver(
  phase: PhaseDefinitionRecord,
  deps: PhasePlatformDeps,
): Promise<PhaseDriver<PhaseCoverageTask | PlaceEnrichmentJobRecord>> {
  // Тики только по RMQ wake(∅) из phaseWakeScheduler (timer→RMQ).
  const schedule = { mode: "event" as const };

  if (phase.scope === "ingestParse") {
    if (!deps.parseTool) {
      throw new Error(`parse phase ${phase.id}: parseTool missing`);
    }
    const parseTool = deps.parseTool;
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
          await parseTool.run(phase, task as PhaseCoverageTask);
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
