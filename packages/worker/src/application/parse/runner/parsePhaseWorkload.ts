/**
 * ---
 * layer: worker/application
 * domain: parse/runner
 * purpose: Wave 4 (tracking-parse-architecture-refactor) — ОДНА scheduled ingestParse-фаза как
 *          workload на runner platform. Алгоритм не переписан: `PhaseRunner.runDrain` (claim из
 *          phase_coverage → handler → markDone/markFailed) — та же функция, что использует legacy
 *          `IngestParseDaemonService`. Явно НЕ трогаем в этой волне: сам `phase_coverage` как
 *          message-copy queue остаётся (см. план, "убрать message-copy queue" — отдельная,
 *          более глубокая задача, требует согласования из-за audit/UI зависимостей).
 *          Здесь меняется только runtime-оболочка: `trigger -> ingest(loadSlice) -> run(evaluate)
 *          -> signaling(telemetry)` вместо bespoke `Map<phaseId, Timer>` в IngestParseDaemonService.
 * ---
 */
import type {
  IPhaseCoverageRepository,
  IPhaseRunRepository,
  PhaseDefinitionRecord,
  PhaseRunStats,
} from "@radar/shared";
import { createWorkbook } from "@radar/shared";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import { createWorkload, type Workload } from "../../runtime/workload/createWorkload.js";
import { createTelemetryBus, type TelemetryBus } from "../../runtime/runner-platform/telemetryBus.js";

export const PARSE_PIPELINE_KEY = "parse";

export type ParsePhaseArtifact = {
  phaseId: string;
  stats: PhaseRunStats;
};

type ParsePhaseSlice = { phase: PhaseDefinitionRecord };

const STALE_RUN_MS = 2 * 60 * 60 * 1000;

export type ParsePhaseWorkloadDeps = {
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  runner: PhaseRunner;
};

export function createParsePhaseWorkload(
  deps: ParsePhaseWorkloadDeps,
  phase: PhaseDefinitionRecord,
): Workload & { telemetry: TelemetryBus<ParsePhaseArtifact> } {
  const telemetry = createTelemetryBus<ParsePhaseArtifact>();

  const workbook = createWorkbook<Record<string, never>, ParsePhaseSlice, ParsePhaseArtifact>({
    pipelineKey: PARSE_PIPELINE_KEY,
    phases: [{ id: phase.id, enabled: phase.enabled, label: phase.id }],
    evaluate: async (slice, ctx) => {
      const control = await ctx.checkControl();
      if (control !== "continue") {
        const idleStats: PhaseRunStats = { claimed: 0, processed: 0, ok: 0, failed: 0 };
        return { artifact: { phaseId: slice.phase.id, stats: idleStats }, nextCursor: {} };
      }
      const run = await deps.phaseRuns.create({
        phaseId: slice.phase.id,
        trigger: "scheduled",
        status: "pending",
      });
      const stats = await deps.runner.runDrain({
        phase: slice.phase,
        runId: run.id,
        batchSize: slice.phase.policy.batchSize,
        trigger: "scheduled",
      });
      return { artifact: { phaseId: slice.phase.id, stats }, nextCursor: {} };
    },
  });

  const intervalMs = Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);

  return {
    ...createWorkload({
      workbook,
      schedule: { mode: "hybrid", intervalMs },
      io: {
        cursorStore: {
          read: async () => ({}),
          write: async () => {},
          reset: async () => {},
        },
        loadSlice: async () => {
          const stale = await deps.phaseRuns.failStaleActiveRuns(phase.id, STALE_RUN_MS);
          if (stale > 0) {
            console.warn(`[parse-runner:${phase.id}] failed ${stale} stale run(s)`);
          }
          const active = await deps.phaseRuns.findActiveForPhase(phase.id);
          if (active) return { slice: { phase }, isEmpty: true };

          const counts = await deps.coverage.countByStatus(phase.id);
          const pendingWork = counts.pending + counts.processing;
          if (pendingWork === 0) return { slice: { phase }, isEmpty: true };

          return { slice: { phase }, isEmpty: false };
        },
        // `runDrain` уже сохраняет весь прогресс сам (phase_runs.stats/log/status) — здесь
        // materialize не нужен, тик полностью самодостаточен.
        materialize: async () => {},
        emitProgress: (envelope) => telemetry.publish(envelope),
      },
      onUnhandledError: (error) => {
        console.error(`[parse-runner:${phase.id}] tick failed:`, error);
      },
    }),
    telemetry,
  };
}

