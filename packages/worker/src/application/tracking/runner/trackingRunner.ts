/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Wave 3 (tracking-parse-architecture-refactor) — tracking-workload на runner platform.
 *          Алгоритм НЕ переписан: `loadCandidateWindow`/`runIncrementalBatch` — те же функции, что
 *          использует legacy `TrackingRebuildDaemon`. Изменён только runtime-контур:
 *          `trigger -> ingest(loadSlice) -> run(evaluate) -> materialize -> signaling(telemetry)`
 *          вместо ручного `setInterval` + инлайн-SQL в классе демона.
 *
 *          Runtime: runner-platform (infra.manifest.json runners).
 *          Не валидирован против прод-нагрузки — включать только после отдельной проверки.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  H3VectorFlowMap,
  resolveDaemonBatchSize,
  createWorkbook,
} from "@radar/shared";
import { DEFAULT_WORKER_RUNTIME_MANIFEST } from "@radar/shared/manifest/domains/workerRuntime.loader.js";
import {
  ensureActiveTrackingRun,
  readTrackingPipelineState,
  readTrackingRunControl,
  resetTrackingWatermark,
} from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";
import {
  loadPendingTrackingCandidates,
  loadTrackingStrobeCandidates,
} from "../loadTrackingCandidates.js";
import { runIncrementalBatch, countTrackingPipelineRemaining } from "../trackingRebuildService.js";
import {
  finalizeTrackingStrobeAtomically,
  loadDirtyTrackingStrobe,
  loadReadyTrackingStrobes,
  resetTrackingStrobeTail,
  stageTrackingCandidates,
} from "../../../infrastructure/tracking/trackingStrobeRepository.js";
import type { JobKernelObsPort } from "../../runtime/runner-platform/jobKernel.js";
import { createWorkload, type Workload } from "../../runtime/workload/createWorkload.js";
import { createTrackingMaterialize } from "./trackingMaterializationPorts.js";
import { createTrackingTelemetryBridge, TRACKING_PIPELINE_KEY } from "./trackingTelemetryBridge.js";
import type {
  TrackingCursorSnapshot,
  TrackingRunnerArtifact,
  TrackingRunnerSlice,
} from "./trackingRunnerContracts.js";

export type CreateTrackingRunnerOptions = {
  intervalMs?: number;
};

export type TrackingRunner = Workload & {
  telemetry: ReturnType<typeof createTrackingTelemetryBridge>["bus"];
};

export function createTrackingRunner(
  ds: DataSource,
  obs?: JobKernelObsPort,
  options?: CreateTrackingRunnerOptions,
): TrackingRunner {
  const intervalMs =
    options?.intervalMs ?? DEFAULT_WORKER_RUNTIME_MANIFEST.tracking.intervalMs;
  // intervalMs — для timer→RMQ снаружи (composition); workload сам только event.
  void intervalMs;
  const telemetryBridge = createTrackingTelemetryBridge();

  function restoreFlowField(
    h3Resolution: number,
    snapshot: ReturnType<H3VectorFlowMap["exportSnapshot"]>,
  ): H3VectorFlowMap {
    const field = new H3VectorFlowMap(h3Resolution);
    field.loadSnapshot(snapshot);
    return field;
  }

  const workbook = createWorkbook<TrackingCursorSnapshot, TrackingRunnerSlice, TrackingRunnerArtifact>({
    pipelineKey: TRACKING_PIPELINE_KEY,
    phases: [{ id: "incremental-batch", enabled: true, label: "cluster+field_train+join (nextgen)" }],
    evaluate: async (slice, ctx) => {
      const control = await ctx.checkControl();
      if (control !== "continue") {
        return {
          artifact: { runId: slice.run.id, result: null, stats: { stage: "idle" } },
          nextCursor: await readTrackingPipelineState(ds),
        };
      }

      try {
        if (slice.finalizeOnly) {
          await finalizeTrackingStrobeAtomically(ds, slice.strobeId);
          return {
            artifact: { runId: slice.run.id, result: null, stats: { stage: "idle" } },
            nextCursor: await readTrackingPipelineState(ds),
          };
        }

        const flowField = restoreFlowField(slice.config.nextgen?.h3Resolution ?? 8, slice.flowSnapshot);
        let lastStats: Parameters<NonNullable<Parameters<typeof runIncrementalBatch>[1]["onProgress"]>>[0] = {};
        const result = await runIncrementalBatch(ds, {
          candidates: slice.chunk,
          candidateWindow: slice.window,
          fullPendingIds: slice.fullPendingIds,
          rebuildGen: slice.run.rebuildGen,
          config: slice.config,
          flowField,
          checkpoint: { runId: slice.run.id, totalCandidates: slice.totalCandidates },
          checkpointStrobeId: slice.strobeId,
          onProgress: async (stats) => {
            lastStats = stats;
            obs?.onLiveMetrics?.(stats as Record<string, unknown>);
          },
        });

        const remaining = await countTrackingPipelineRemaining(ds, { until: new Date() });
        const isDone = remaining === 0;
        const stats = {
          ...lastStats,
          stage: isDone ? ("done" as const) : ("idle" as const),
          pendingCandidates: remaining,
          totalCandidates: slice.totalCandidates,
        };

        return {
          artifact: { runId: slice.run.id, result, stats },
          nextCursor: await readTrackingPipelineState(ds),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`tracking runner batch failed (run=${slice.run.id}): ${message}`, { cause: error });
      }
    },
  });

  async function loadSlice(_cursor: TrackingCursorSnapshot) {
    const state = await readTrackingPipelineState(ds);
    if (!state.enabled) return { slice: EMPTY_SLICE, isEmpty: true };

    const until = new Date();
    const batchSize = resolveDaemonBatchSize(state.config.batchSize);
    const pending = await loadPendingTrackingCandidates(ds, {
      until,
      limit: batchSize,
    });
    await stageTrackingCandidates(ds, pending, state.config);
    let currentState = state;
    let strobe = await loadDirtyTrackingStrobe(ds);
    if (strobe) {
      await resetTrackingStrobeTail(ds, strobe);
      currentState = await readTrackingPipelineState(ds);
      strobe = await loadDirtyTrackingStrobe(ds);
    }

    const ready = await loadReadyTrackingStrobes(ds, until);
    const finalizable = strobe == null ? ready[0] : null;
    const selected = strobe ?? finalizable;
    const run = await ensureActiveTrackingRun(ds, currentState, selected != null);
    if (!run) return { slice: EMPTY_SLICE, isEmpty: true };

    if (!selected) {
      return { slice: EMPTY_SLICE, isEmpty: true };
    }

    const control = await readTrackingRunControl(ds, run.id);
    if (control?.pause || control?.cancel) return { slice: EMPTY_SLICE, isEmpty: true };

    const members = finalizable ? [] : await loadTrackingStrobeCandidates(ds, selected.id);
    const totalCandidates = await countTrackingPipelineRemaining(ds, { until });

    const slice: TrackingRunnerSlice = {
      run,
      strobeId: selected.id,
      finalizeOnly: finalizable != null,
      chunk: members,
      window: members,
      fullPendingIds: new Set(members.map((c) => c.eventLocationId)),
      totalCandidates,
      config: currentState.config,
      flowSnapshot: currentState.flowSnapshot,
    };
    return { slice, isEmpty: false };
  }

  const workload = createWorkload({
    workbook,
    // Wake только запускает SQL-drain; адресные данные runner читает из PostgreSQL.
    schedule: { mode: "event" },
    io: {
      cursorStore: {
        read: () => readTrackingPipelineState(ds),
        // Реальный watermark уже персистится в materialize (advanceTrackingWatermark);
        // read() каждый раз перечитывает свежее состояние из БД — write() здесь формальность.
        write: async () => {},
        reset: () => resetTrackingWatermark(ds),
      },
      loadSlice,
      materialize: createTrackingMaterialize(ds),
      emitProgress: telemetryBridge.emitProgress,
    },
    onUnhandledError: (error) => {
      console.error(`[${TRACKING_PIPELINE_KEY}] tick failed:`, error);
    },
    obs,
  });

  return { ...workload, telemetry: telemetryBridge.bus };
}

const EMPTY_SLICE: TrackingRunnerSlice = {
  run: { id: "", rebuildGen: "", startedAt: "" },
  strobeId: "",
  finalizeOnly: false,
  chunk: [],
  window: [],
  fullPendingIds: new Set(),
  totalCandidates: 0,
  config: {} as TrackingRunnerSlice["config"],
  flowSnapshot: { vectors: {}, mass: {} },
};
