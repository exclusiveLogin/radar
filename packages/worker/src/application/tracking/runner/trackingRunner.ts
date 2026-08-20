/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Tracking workload: phase A (strobe cluster) и phase B (global join winners).
 *          Батч — только перфоманс; окно алгоритма join задаётся seeds as-of + maxGapMs.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  H3VectorFlowMap,
  resolveDaemonBatchSize,
  createWorkbook,
  type TrackingCandidate,
  type TrackingWatermark,
} from "@radar/shared";
import { DEFAULT_WORKER_RUNTIME_MANIFEST } from "@radar/shared/manifest/domains/workerRuntime.loader.js";
import {
  ensureActiveTrackingRun,
  readTrackingPipelineState,
  readTrackingRunControl,
  resetTrackingWatermark,
} from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";
import {
  hasPendingTrackingCandidates,
  loadPendingTrackingCandidates,
  loadTrackingCandidatesByIds,
  loadTrackingStrobeCandidates,
} from "../loadTrackingCandidates.js";
import { runIncrementalBatch, countTrackingPipelineRemaining } from "../trackingRebuildService.js";
import {
  deleteTrackingStrobe,
  finalizeTrackingStrobeAtomically,
  hasPendingJoinWinners,
  hasUnprocessedTrackingStrobes,
  loadDirtyTrackingStrobe,
  loadJoinWinnerIds,
  loadReadyTrackingStrobes,
  resetTrackingStrobeTail,
  stageTrackingCandidates,
  type TrackingStrobe,
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

/** Полный COUNT остатка сканирует всю mat_parse_location — уточняем редко. */
const REMAINING_REFRESH_MS = 5 * 60 * 1000;

/** Ограничение уборки стробов-призраков за один тик. */
const MAX_GHOST_STROBES_PER_TICK = 500;

type DirtyStrobe = { strobe: TrackingStrobe; members: TrackingCandidate[] };

function createRemainingTracker(ds: DataSource) {
  let value: number | null = null;
  let refreshedAt = 0;

  return {
    async read(until: Date): Promise<number> {
      if (value == null || Date.now() - refreshedAt >= REMAINING_REFRESH_MS) {
        value = await countTrackingPipelineRemaining(ds, { until });
        refreshedAt = Date.now();
      }
      return value;
    },
    consume(count: number): void {
      if (value != null) value = Math.max(0, value - count);
    },
  };
}

export type TrackingRunner = Workload & {
  telemetry: ReturnType<typeof createTrackingTelemetryBridge>["bus"];
};

export function createTrackingRunner(
  ds: DataSource,
  obs?: JobKernelObsPort,
  options?: CreateTrackingRunnerOptions,
): TrackingRunner {
  const stagingIntervalMs =
    options?.intervalMs ?? DEFAULT_WORKER_RUNTIME_MANIFEST.tracking.intervalMs;
  const telemetryBridge = createTrackingTelemetryBridge();
  const remaining = createRemainingTracker(ds);
  let lastStagedAt = 0;

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
    phases: [
      { id: "cluster-strobe", enabled: true, label: "phase A: ST-DBSCAN winners" },
      { id: "join-winners", enabled: true, label: "phase B: Kalman join winners" },
    ],
    evaluate: async (slice, ctx) => {
      const control = await ctx.checkControl();
      if (control !== "continue") {
        return {
          artifact: { runId: slice.run.id, result: null, stats: { stage: "idle" } },
          nextCursor: await readTrackingPipelineState(ds),
        };
      }

      try {
        if (slice.phase === "finalize") {
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
          rebuildAt: slice.rebuildAt,
          config: slice.config,
          flowField,
          phase: slice.phase === "cluster" ? "cluster" : "join",
          checkpoint: { runId: slice.run.id, totalCandidates: slice.totalCandidates },
          checkpointStrobeId: slice.phase === "cluster" ? slice.strobeId : undefined,
          onProgress: async (stats) => {
            lastStats = stats;
            obs?.onLiveMetrics?.(stats as Record<string, unknown>);
          },
        });

        const until = new Date();
        remaining.consume(slice.chunk.length);
        const isDone =
          !(await hasUnprocessedTrackingStrobes(ds, until))
          && !(await hasPendingJoinWinners(ds))
          && !(await hasPendingTrackingCandidates(ds, { until }));
        const stats = {
          ...lastStats,
          stage: isDone ? ("done" as const) : ("idle" as const),
          pendingCandidates: isDone ? 0 : await remaining.read(until),
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

  async function stageNewCandidates(
    state: Awaited<ReturnType<typeof readTrackingPipelineState>>,
    until: Date,
  ): Promise<void> {
    if (Date.now() - lastStagedAt < stagingIntervalMs) return;
    lastStagedAt = Date.now();

    const pending = await loadPendingTrackingCandidates(ds, {
      until,
      limit: resolveDaemonBatchSize(state.config.batchSize),
    });
    await stageTrackingCandidates(ds, pending, state.config);
  }

  async function takeDirtyStrobeWithMembers(): Promise<DirtyStrobe | null> {
    for (let skipped = 0; skipped < MAX_GHOST_STROBES_PER_TICK; skipped += 1) {
      const strobe = await loadDirtyTrackingStrobe(ds);
      if (!strobe) return null;

      const members = await loadTrackingStrobeCandidates(ds, strobe.id);
      if (members.length > 0) return { strobe, members };

      await deleteTrackingStrobe(ds, strobe.id);
    }
    return null;
  }

  function watermarkFromState(
    state: Awaited<ReturnType<typeof readTrackingPipelineState>>,
  ): TrackingWatermark | null {
    const wm = state.watermark;
    if (
      wm
      && typeof wm === "object"
      && "lastOccurredAt" in wm
      && "lastEventLocationId" in wm
      && typeof wm.lastOccurredAt === "string"
      && typeof wm.lastEventLocationId === "string"
    ) {
      return wm as TrackingWatermark;
    }
    return null;
  }

  async function loadSlice(_cursor: TrackingCursorSnapshot) {
    const state = await readTrackingPipelineState(ds);
    if (!state.enabled) return { slice: EMPTY_SLICE, isEmpty: true };

    // Live frontier = now(); retracking истории идёт тем же кодом: staging
    // наполняет бины, phase A/B читают event-time курсор из PostgreSQL.
    const frontier = new Date();
    await stageNewCandidates(state, frontier);
    let currentState = state;
    let dirty = await takeDirtyStrobeWithMembers();
    if (dirty) {
      await resetTrackingStrobeTail(ds, dirty.strobe);
      currentState = await readTrackingPipelineState(ds);
      dirty = await takeDirtyStrobeWithMembers();
    }

    const hasWork = dirty != null
      || (await hasPendingJoinWinners(ds))
      || (await loadReadyTrackingStrobes(ds, frontier)).length > 0;
    const run = await ensureActiveTrackingRun(ds, currentState, hasWork);
    if (!run) return { slice: EMPTY_SLICE, isEmpty: true };

    const control = await readTrackingRunControl(ds, run.id);
    if (control?.pause || control?.cancel) return { slice: EMPTY_SLICE, isEmpty: true };

    const totalCandidates = await remaining.read(frontier);

    // Phase A имеет приоритет: без winners join смотреть не на что.
    if (dirty) {
      const rebuildAt = dirty.members.reduce(
        (max, c) => (c.occurredAt > max ? c.occurredAt : max),
        dirty.strobe.closesAt,
      );
      const slice: TrackingRunnerSlice = {
        run,
        phase: "cluster",
        strobeId: dirty.strobe.id,
        rebuildAt,
        chunk: dirty.members,
        window: dirty.members,
        fullPendingIds: new Set(dirty.members.map(c => c.eventLocationId)),
        totalCandidates,
        config: currentState.config,
        flowSnapshot: currentState.flowSnapshot,
      };
      return { slice, isEmpty: false };
    }

    // Phase B: страница winners по watermark (батч ≠ окно алгоритма).
    const winnerIds = await loadJoinWinnerIds(
      ds,
      watermarkFromState(currentState),
      resolveDaemonBatchSize(currentState.config.batchSize),
    );
    if (winnerIds.length > 0) {
      const winners = await loadTrackingCandidatesByIds(ds, winnerIds);
      if (winners.length === 0) return { slice: EMPTY_SLICE, isEmpty: true };
      const rebuildAt = winners[winners.length - 1]!.occurredAt;
      const slice: TrackingRunnerSlice = {
        run,
        phase: "join",
        strobeId: "",
        rebuildAt,
        chunk: winners,
        window: winners,
        fullPendingIds: new Set(winners.map(c => c.eventLocationId)),
        totalCandidates,
        config: currentState.config,
        flowSnapshot: currentState.flowSnapshot,
      };
      return { slice, isEmpty: false };
    }

    const ready = await loadReadyTrackingStrobes(ds, frontier);
    if (ready[0]) {
      const slice: TrackingRunnerSlice = {
        run,
        phase: "finalize",
        strobeId: ready[0].id,
        rebuildAt: ready[0].closesAt,
        chunk: [],
        window: [],
        fullPendingIds: new Set(),
        totalCandidates,
        config: currentState.config,
        flowSnapshot: currentState.flowSnapshot,
      };
      return { slice, isEmpty: false };
    }

    return { slice: EMPTY_SLICE, isEmpty: true };
  }

  const workload = createWorkload({
    workbook,
    schedule: { mode: "event", drainUntilEmpty: true },
    io: {
      cursorStore: {
        read: () => readTrackingPipelineState(ds),
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
  phase: "finalize",
  strobeId: "",
  rebuildAt: new Date(0),
  chunk: [],
  window: [],
  fullPendingIds: new Set(),
  totalCandidates: 0,
  config: {} as TrackingRunnerSlice["config"],
  flowSnapshot: { vectors: {}, mass: {} },
};
