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
 *          schedulingImpl в deployment.manifest.json (ADR-021).
 *          Не валидирован против прод-нагрузки — включать только после отдельной проверки.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  H3VectorFlowMap,
  maxEpsilonTemporalMs,
  orderTrackingCandidates,
  resolveTrackingTemporalReplay,
  resolveDaemonBatchSize,
  createWorkbook,
} from "@radar/shared";
import { DEFAULT_WORKER_RUNTIME_MANIFEST } from "@radar/shared/manifest/domains/workerRuntime.loader.js";
import {
  ensureActiveTrackingRun,
  readTrackingPipelineState,
  readTrackingRunControl,
  resetTrackingTemporalTail,
  resetTrackingWatermark,
} from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";
import { loadCandidateWindow, runIncrementalBatch, countTrackingPipelineRemaining } from "../trackingRebuildService.js";
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
  const flowFieldByRun = new Map<string, H3VectorFlowMap>();
  const telemetryBridge = createTrackingTelemetryBridge();

  function acquireFlowField(runId: string, h3Resolution: number): H3VectorFlowMap {
    const existing = flowFieldByRun.get(runId);
    if (existing) return existing;
    const field = new H3VectorFlowMap(h3Resolution);
    flowFieldByRun.set(runId, field);
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
        const flowField = acquireFlowField(slice.run.id, slice.config.nextgen?.h3Resolution ?? 8);
        let lastStats: Parameters<NonNullable<Parameters<typeof runIncrementalBatch>[1]["onProgress"]>>[0] = {};
        const result = await runIncrementalBatch(ds, {
          candidates: slice.chunk,
          candidateWindow: slice.window,
          fullPendingIds: slice.fullPendingIds,
          rebuildGen: slice.run.rebuildGen,
          config: slice.config,
          flowField,
          onProgress: async (stats) => {
            lastStats = stats;
            obs?.onLiveMetrics?.(stats as Record<string, unknown>);
          },
        });

        const remaining = await countTrackingPipelineRemaining(ds, { until: new Date() });
        const isDone = remaining === 0;
        if (isDone) flowFieldByRun.delete(slice.run.id);

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
        flowFieldByRun.delete(slice.run.id);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`tracking runner batch failed (run=${slice.run.id}): ${message}`, { cause: error });
      }
    },
  });

  async function loadSlice(_cursor: TrackingCursorSnapshot) {
    const state = await readTrackingPipelineState(ds);
    if (!state.enabled) return { slice: EMPTY_SLICE, isEmpty: true };

    const until = new Date();
    const lookbackMs = maxEpsilonTemporalMs(state.config.profiles);
    let { pending, window } = await loadCandidateWindow(ds, { until, lookbackMs });
    const replay = resolveTrackingTemporalReplay(pending, state.watermark, state.config.profiles);
    if (replay) {
      await resetTrackingTemporalTail(ds, replay.since);
      flowFieldByRun.clear();
      ({ pending, window } = await loadCandidateWindow(ds, { until, lookbackMs }));
    }

    const run = await ensureActiveTrackingRun(ds, state, pending.length > 0);
    if (!run) return { slice: EMPTY_SLICE, isEmpty: true };

    if (pending.length === 0) {
      const remaining = await countTrackingPipelineRemaining(ds, { until });
      await createTrackingMaterialize(ds)({
        runId: run.id,
        result: null,
        stats: { stage: "done", pendingCandidates: remaining },
      });
      return { slice: EMPTY_SLICE, isEmpty: true };
    }

    const control = await readTrackingRunControl(ds, run.id);
    if (control?.pause || control?.cancel) return { slice: EMPTY_SLICE, isEmpty: true };

    const batchSize = resolveDaemonBatchSize(state.config.batchSize);
    // Wake только будит workload; порядок решений всегда определяется event-time.
    const chunk = orderTrackingCandidates(pending).slice(0, batchSize);
    const totalCandidates = await countTrackingPipelineRemaining(ds, { until });

    const slice: TrackingRunnerSlice = {
      run,
      chunk,
      window,
      fullPendingIds: new Set(pending.map((c) => c.eventLocationId)),
      totalCandidates,
      config: state.config,
    };
    return { slice, isEmpty: false };
  }

  const workload = createWorkload({
    workbook,
    // timer→RMQ wake(∅); event wake с ids — через trackingIngestSubscriber
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
  chunk: [],
  window: [],
  fullPendingIds: new Set(),
  totalCandidates: 0,
  config: {} as TrackingRunnerSlice["config"],
};
