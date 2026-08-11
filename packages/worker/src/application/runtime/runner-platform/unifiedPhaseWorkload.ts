/**
 * Unified phase workload — schedule/wake + один drainOnce на тик (ADR-025).
 * evaluate = mill drainOnce + session; geo policy — в PhaseTickGate.
 */
import type { PhaseDefinitionRecord, PhaseRunStats } from "@radar/shared";
import { createWorkbook } from "@radar/shared";
import { createPhaseTickGate } from "../../phases/phaseTickGate.js";
import { buildPhaseDriver } from "./phaseDriver.js";
import type { PhasePlatformDeps } from "./phasePlatformDeps.js";
import { createUnifiedRunner } from "./unifiedRunner.js";
import type { JobKernelObsPort } from "./jobKernel.js";
import { createWorkload, type Workload } from "../workload/createWorkload.js";
import { createTelemetryBus, type TelemetryBus } from "./telemetryBus.js";

export const UNIFIED_PHASE_PIPELINE_KEY = "unified-phase";

export type UnifiedPhaseArtifact = {
  phaseId: string;
  stats: PhaseRunStats;
};

type UnifiedPhaseSlice = { phase: PhaseDefinitionRecord };

export type UnifiedPhaseWorkloadDeps = PhasePlatformDeps;

export function createUnifiedPhaseWorkload(
  deps: UnifiedPhaseWorkloadDeps,
  phase: PhaseDefinitionRecord,
  obs?: JobKernelObsPort,
): Workload & { telemetry: TelemetryBus<UnifiedPhaseArtifact> } {
  const telemetry = createTelemetryBus<UnifiedPhaseArtifact>();
  const pipelineKey = phase.scope === "ingestParse" ? "parse" : "geo-enrich";
  const schedule = { mode: "event" as const };
  const tickGate = createPhaseTickGate({
    phaseRuns: deps.phaseRuns,
    placeJobs: deps.placeJobs,
  });

  const workbook = createWorkbook<Record<string, never>, UnifiedPhaseSlice, UnifiedPhaseArtifact>({
    pipelineKey,
    phases: [{ id: phase.id, enabled: phase.enabled, label: phase.id }],
    evaluate: async (slice, ctx) => {
      const control = await ctx.checkControl();
      if (control !== "continue") {
        const idle: PhaseRunStats = { claimed: 0, processed: 0, ok: 0, failed: 0 };
        return { artifact: { phaseId: slice.phase.id, stats: idle }, nextCursor: {} };
      }

      const run = await deps.session.resolveForTick({
        phase: slice.phase,
        trigger: "scheduled",
      });

      const driver = await buildPhaseDriver(slice.phase, deps);
      const tick = await createUnifiedRunner({
        queue: driver.queue,
        batchSize: slice.phase.policy.batchSize,
        handle: driver.runItem,
      }).drainOnce();

      const totals: PhaseRunStats = {
        claimed: tick.claimed,
        processed: tick.processed,
        ok: tick.ok,
        failed: tick.failed,
      };
      await deps.session.phaseRuns.updateStats(run.id, totals);
      await deps.session.finalize(run.id, "completed", totals);
      return { artifact: { phaseId: slice.phase.id, stats: totals }, nextCursor: {} };
    },
  });

  return {
    ...createWorkload({
      workbook,
      schedule,
      io: {
        cursorStore: {
          read: async () => ({}),
          write: async () => {},
          reset: async () => {},
        },
        loadSlice: async () => {
          const gate = await tickGate.beforeTick(phase);
          return { slice: { phase }, isEmpty: gate.skip };
        },
        materialize: async () => {},
        emitProgress: (envelope) =>
          telemetry.publish({ ...envelope, phaseKey: `${pipelineKey}.${phase.id}` }),
      },
      onUnhandledError: (error) => {
        console.error(`[unified.${phase.id}] tick failed:`, error);
      },
      obs,
    }),
    telemetry,
  };
}
