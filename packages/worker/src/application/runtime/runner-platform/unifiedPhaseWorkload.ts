/**
 * Unified phase workload — schedule/wake + один drainOnce на тик (ADR-025).
 */
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PlaceEnrichmentProvider,
} from "@radar/shared";
import { createWorkbook, resolveGeoEnrichmentProvider } from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../../geo-parse/placeEnrichmentRunner.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import { buildPhaseDriver, triggerModeToSchedule } from "./phaseDriver.js";
import { createUnifiedRunner } from "./unifiedRunner.js";
import type { JobKernelObsConfig } from "./jobKernel.js";
import { createWorkload, type Workload } from "../workload/createWorkload.js";
import { createTelemetryBus, type TelemetryBus } from "./telemetryBus.js";

export const UNIFIED_PHASE_PIPELINE_KEY = "unified-phase";

export type UnifiedPhaseArtifact = {
  phaseId: string;
  stats: PhaseRunStats;
};

type UnifiedPhaseSlice = { phase: PhaseDefinitionRecord };

const STALE_RUN_MS = 2 * 60 * 60 * 1000;

export type UnifiedPhaseWorkloadDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  runner: PhaseRunner;
  placeEnrichmentRunner?: PlaceEnrichmentRunner;
};

export function createUnifiedPhaseWorkload(
  deps: UnifiedPhaseWorkloadDeps,
  phase: PhaseDefinitionRecord,
  obs?: JobKernelObsConfig,
): Workload & { telemetry: TelemetryBus<UnifiedPhaseArtifact> } {
  const telemetry = createTelemetryBus<UnifiedPhaseArtifact>();
  const pipelineKey = phase.scope === "ingestParse" ? "parse" : "geo-enrich";
  const intervalMs = Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
  const schedule = triggerModeToSchedule(phase.triggerMode, intervalMs);

  const workbook = createWorkbook<Record<string, never>, UnifiedPhaseSlice, UnifiedPhaseArtifact>({
    pipelineKey,
    phases: [{ id: phase.id, enabled: phase.enabled, label: phase.id }],
    evaluate: async (slice, ctx) => {
      const control = await ctx.checkControl();
      if (control !== "continue") {
        const idle: PhaseRunStats = { claimed: 0, processed: 0, ok: 0, failed: 0 };
        return { artifact: { phaseId: slice.phase.id, stats: idle }, nextCursor: {} };
      }

      const run = await deps.phaseRuns.create({
        phaseId: slice.phase.id,
        trigger: "scheduled",
        status: "pending",
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
      await deps.phaseRuns.updateStats(run.id, totals);
      await deps.phaseRuns.updateStatus(run.id, "completed", { stats: totals });
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
          // Mutex = job SKIP LOCKED, не active phase_run (live ids из самого catch-up).
          await deps.phaseRuns.failStaleActiveRuns(phase.id, STALE_RUN_MS);

          if (phase.scope === "geoParse") {
            const provider = resolveGeoEnrichmentProvider(phase) as PlaceEnrichmentProvider | null;
            if (provider === "nominatim") {
              const dadata = await deps.placeJobs.countByStatus("dadata");
              if (dadata.pending + dadata.processing > 0) {
                return { slice: { phase }, isEmpty: true };
              }
            }
          }

          return { slice: { phase }, isEmpty: false };
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
