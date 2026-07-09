/**
 * ---
 * layer: worker/application
 * domain: geo-enrich/runner
 * purpose: Wave 5 (tracking-parse-architecture-refactor) — geo-enrich как третий context на
 *          runner platform. Алгоритм не переписан: `PhaseRunner.runDrain` (→ `PlaceEnrichmentRunner`
 *          select→enrich→merge) — та же функция, что использует legacy `PlaceEnrichmentDaemonService`.
 *          Одна фаза за раз, по order (dadata → nominatim → llm), nominatim ждёт пустую очередь
 *          dadata — та же политика, что и в legacy-демоне, перенесённая внутрь одного evaluate.
 *          За флагом `GEO_ENRICH_RUNNER_PLATFORM_ENABLED` (default off), взаимоисключим с
 *          `PlaceEnrichmentDaemonService`.
 * ---
 */
import type {
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PlaceEnrichmentProvider,
} from "@radar/shared";
import { createWorkbook, resolveGeoEnrichmentProvider } from "@radar/shared";
import { sortPhasesByOrder } from "../../phases/phaseOrder.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import type { JobKernelObsConfig } from "../../runtime/runner-platform/jobKernel.js";
import {
  createWorkloadObsConfig,
  type WorkloadObsContext,
} from "../../runtime/observability/workloadObsHooks.js";
import { createWorkload, type Workload } from "../../runtime/workload/createWorkload.js";
import { createTelemetryBus, type TelemetryBus } from "../../runtime/runner-platform/telemetryBus.js";

export const GEO_ENRICH_PIPELINE_KEY = "geo-enrich";

const DEFAULT_REFRESH_MS = 15_000;
const STALE_RUN_MS = 2 * 60 * 60 * 1000;
const ORPHAN_RUN_MS = 60_000;

export function isGeoEnrichRunnerPlatformEnabled(): boolean {
  return process.env.GEO_ENRICH_RUNNER_PLATFORM_ENABLED === "true";
}

export type GeoEnrichPhaseOutcome = {
  phaseId: string;
  provider: PlaceEnrichmentProvider;
  stats: PhaseRunStats;
};
export type GeoEnrichArtifact = { outcomes: GeoEnrichPhaseOutcome[] };

type GeoEnrichSlice = { phases: PhaseDefinitionRecord[] };

export type GeoEnrichRunnerDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  runner: PhaseRunner;
};

export type GeoEnrichRunner = Workload & { telemetry: TelemetryBus<GeoEnrichArtifact> };

export function createGeoEnrichRunner(
  deps: GeoEnrichRunnerDeps,
  obsCtx?: WorkloadObsContext,
): GeoEnrichRunner {
  const telemetry = createTelemetryBus<GeoEnrichArtifact>();
  const lastDrainAt = new Map<string, number>();
  const obs: JobKernelObsConfig | undefined = obsCtx
    ? createWorkloadObsConfig(obsCtx)
    : undefined;

  async function isDadataQueueBusy(): Promise<boolean> {
    const counts = await deps.placeJobs.countByStatus("dadata");
    return counts.pending + counts.processing > 0;
  }

  async function drainPhase(
    phase: PhaseDefinitionRecord,
    provider: PlaceEnrichmentProvider,
  ): Promise<GeoEnrichPhaseOutcome | null> {
    const stale = await deps.phaseRuns.failStaleActiveRuns(phase.id, STALE_RUN_MS);
    if (stale > 0) console.warn(`[${GEO_ENRICH_PIPELINE_KEY}.${phase.id}] failed ${stale} stale run(s)`);

    let active = await deps.phaseRuns.findActiveForPhase(phase.id);
    if (active) {
      const orphans = await deps.phaseRuns.failStaleActiveRuns(phase.id, ORPHAN_RUN_MS);
      if (orphans > 0) {
        const reset = await deps.placeJobs.resetProcessingForProvider(provider);
        console.warn(`[${GEO_ENRICH_PIPELINE_KEY}.${phase.id}] stale run failed, processing→pending=${reset}`);
        active = await deps.phaseRuns.findActiveForPhase(phase.id);
      }
    }

    const counts = await deps.placeJobs.countByStatus(provider);
    const pendingWork = counts.pending + counts.processing;
    if (pendingWork === 0) return null;

    const runId =
      active && (active.status === "running" || active.status === "pending")
        ? active.id
        : (await deps.phaseRuns.create({ phaseId: phase.id, trigger: "scheduled", status: "pending" })).id;

    const stats = await deps.runner.runDrain({
      phase,
      runId,
      batchSize: phase.policy.batchSize,
      trigger: "scheduled",
    });
    return { phaseId: phase.id, provider, stats };
  }

  const workbook = createWorkbook<Record<string, never>, GeoEnrichSlice, GeoEnrichArtifact>({
    pipelineKey: GEO_ENRICH_PIPELINE_KEY,
    phases: [],
    evaluate: async (slice, ctx) => {
      const outcomes: GeoEnrichPhaseOutcome[] = [];
      for (const phase of slice.phases) {
        const control = await ctx.checkControl();
        if (control !== "continue") break;

        const provider = resolveGeoEnrichmentProvider(phase);
        if (!provider) continue;
        if (provider === "nominatim" && (await isDadataQueueBusy())) continue;

        const intervalMs = Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
        const last = lastDrainAt.get(phase.id) ?? 0;
        if (Date.now() - last < intervalMs) continue;

        const outcome = await drainPhase(phase, provider);
        lastDrainAt.set(phase.id, Date.now());
        if (outcome) outcomes.push(outcome);
      }
      return { artifact: { outcomes }, nextCursor: {} };
    },
  });

  return {
    ...createWorkload({
      workbook,
      schedule: { mode: "hybrid", intervalMs: DEFAULT_REFRESH_MS },
      io: {
        cursorStore: {
          read: async () => ({}),
          write: async () => {},
          reset: async () => {},
        },
        loadSlice: async () => {
          const scheduled = sortPhasesByOrder(await deps.phases.listEnabled("scheduled", "geoParse"));
          if (scheduled.length === 0) return { slice: { phases: [] }, isEmpty: true };
          return { slice: { phases: scheduled }, isEmpty: false };
        },
        // `runDrain` уже персистит весь прогресс сам (log_parse_phase_run.stats/log/status).
        materialize: async () => {},
        emitProgress: (envelope) => {
          // Тик может задренировать больше одной фазы (dadata → nominatim) — phaseKey ставим
          // только когда за тик реально отработала ровно одна фаза, иначе он неоднозначен.
          const phaseKey =
            envelope.payload.outcomes.length === 1
              ? `${GEO_ENRICH_PIPELINE_KEY}.${envelope.payload.outcomes[0]!.phaseId}`
              : undefined;
          telemetry.publish({ ...envelope, phaseKey });
        },
      },
      onUnhandledError: (error) => {
        console.error(`[${GEO_ENRICH_PIPELINE_KEY}] tick failed:`, error);
      },
      obs,
    }),
    telemetry,
  };
}
