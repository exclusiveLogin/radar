import type {
  IObservabilityRecorder,
  ObsPipelineRuntime,
  PipelineKey,
} from "@radar/shared";
import type { JobKernelObsPort } from "../runner-platform/jobKernel.js";
import { buildWorkloadId, obsNow } from "./obsContext.js";

export type WorkloadObsContext = {
  recorder: IObservabilityRecorder;
  hostId: string;
  pipelineKey: PipelineKey;
  runtime: ObsPipelineRuntime;
  workloadIdSuffix?: string;
};

/** Собирает конфиг obs для jobKernel / workload producers. */
export function createWorkloadObsConfig(ctx: WorkloadObsContext): JobKernelObsPort {
  const config = {
    recorder: ctx.recorder,
    hostId: ctx.hostId,
    workloadId: buildWorkloadId(ctx.hostId, ctx.pipelineKey, ctx.workloadIdSuffix),
    pipelineKey: ctx.pipelineKey,
    runtime: ctx.runtime,
  };
  return {
    onRunning: () => reportWorkloadRunning(config),
    onPaused: () => reportWorkloadPaused(config),
    onStopped: () => reportWorkloadStopped(config),
    onTickStart: () => reportWorkloadTickStart(config),
    onTickEnd: (metrics) => reportWorkloadTickEnd(config, metrics),
    onMaterialize: () => reportMaterialize(config),
    onLiveMetrics: (metrics) => reportWorkloadLiveMetrics(config, metrics),
  };
}

type WorkloadObsConfig = {
  recorder: IObservabilityRecorder;
  hostId: string;
  workloadId: string;
  pipelineKey: PipelineKey;
  runtime: ObsPipelineRuntime;
};

/** Fire-and-forget upsert workload — ошибки не блокируют pipeline tick. */
function fireUpsertWorkload(
  recorder: IObservabilityRecorder,
  snapshot: Parameters<IObservabilityRecorder["upsertWorkload"]>[0],
): void {
  void recorder.upsertWorkload(snapshot).catch((err: unknown) => {
    console.warn("[obs] upsertWorkload failed:", err);
  });
}

/** Upsert workload в статусе running (start/resume). */
export function reportWorkloadRunning(obs: WorkloadObsConfig): void {
  fireUpsertWorkload(obs.recorder, {
    workloadId: obs.workloadId,
    hostId: obs.hostId,
    pipelineKey: obs.pipelineKey,
    runtime: obs.runtime,
    status: "running",
    lastTickAt: obsNow(),
  });
}

/** Upsert workload в статусе paused. */
export function reportWorkloadPaused(obs: WorkloadObsConfig): void {
  fireUpsertWorkload(obs.recorder, {
    workloadId: obs.workloadId,
    hostId: obs.hostId,
    pipelineKey: obs.pipelineKey,
    runtime: obs.runtime,
    status: "paused",
    lastTickAt: obsNow(),
  });
}

/** Upsert workload в статусе stopped (teardown). */
export function reportWorkloadStopped(obs: WorkloadObsConfig): void {
  fireUpsertWorkload(obs.recorder, {
    workloadId: obs.workloadId,
    hostId: obs.hostId,
    pipelineKey: obs.pipelineKey,
    runtime: obs.runtime,
    status: "stopped",
    lastTickAt: obsNow(),
  });
}

/** Upsert workload в начале tick jobKernel. */
export function reportWorkloadTickStart(obs: WorkloadObsConfig): void {
  fireUpsertWorkload(obs.recorder, {
    workloadId: obs.workloadId,
    hostId: obs.hostId,
    pipelineKey: obs.pipelineKey,
    runtime: obs.runtime,
    status: "running",
    lastTickAt: obsNow(),
  });
}

/** Upsert workload после tick (idle + опциональные metrics). */
export function reportWorkloadTickEnd(
  obs: WorkloadObsConfig,
  metrics?: Record<string, unknown>,
): void {
  fireUpsertWorkload(obs.recorder, {
    workloadId: obs.workloadId,
    hostId: obs.hostId,
    pipelineKey: obs.pipelineKey,
    runtime: obs.runtime,
    status: "idle",
    lastTickAt: obsNow(),
    metrics,
  });
}

/** Счётчик materialize для runner-platform workload. */
export function reportMaterialize(obs: WorkloadObsConfig): void {
  void obs.recorder.recordMaterialize(obs.pipelineKey).catch((err: unknown) => {
    console.warn("[obs] recordMaterialize failed:", err);
  });
}

/** Live metrics во время batch (parity legacy onProgress). */
export function reportWorkloadLiveMetrics(
  obs: WorkloadObsConfig,
  metrics: Record<string, unknown>,
): void {
  fireUpsertWorkload(obs.recorder, {
    workloadId: obs.workloadId,
    hostId: obs.hostId,
    pipelineKey: obs.pipelineKey,
    runtime: obs.runtime,
    status: "running",
    lastTickAt: obsNow(),
    metrics,
  });
}

export type TriggerObsContext = {
  recorder: IObservabilityRecorder;
  pipelineKey: PipelineKey;
  eventType: string;
};

/** Инкремент trigger counter при fire triggerLayer. */
export function reportTrigger(
  obs: TriggerObsContext,
  source: string,
  delta = 1,
): void {
  void obs.recorder
    .incrementTrigger(
      { pipelineKey: obs.pipelineKey, eventType: obs.eventType, source },
      delta,
    )
    .catch((err: unknown) => {
      console.warn("[obs] incrementTrigger failed:", err);
    });
}
