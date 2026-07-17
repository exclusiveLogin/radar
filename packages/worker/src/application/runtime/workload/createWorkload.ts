/**
 * ---
 * layer: worker/runtime
 * domain: workload (binds shared `workbook` domain to worker `runner platform`)
 * purpose: `workload` — выполняемый экземпляр `workbook`: берёт чистый `evaluate` (eval, из
 *          shared/domain/workbook) и связывает его с рантайм-механикой (jobKernel из
 *          runner-platform) + I/O-портами конкретного домена (loadSlice/materialize/cursorStore),
 *          которые предоставляет вызывающий worker-код. Сам workload не знает деталей алгоритма —
 *          только оркестрирует связку.
 * ---
 */
import type { WorkbookDescriptor, WorkbookInstance } from "@radar/shared";
import { createJobKernel, type JobKernel, type JobKernelObsPort } from "../runner-platform/jobKernel.js";
import type { CursorStore } from "../runner-platform/cursorEngine.js";
import type {
  EmitProgress,
  LoadSlice,
  Materialize,
  ScheduleMode,
} from "../runner-platform/runnerContracts.js";

export type WorkloadIoPorts<TCursor, TSlice, TArtifact> = {
  cursorStore: CursorStore<TCursor>;
  loadSlice: LoadSlice<TCursor, TSlice>;
  materialize: Materialize<TArtifact>;
  emitProgress?: EmitProgress<TArtifact>;
};

export type CreateWorkloadOptions<TCursor, TSlice, TArtifact> = {
  workbook: WorkbookInstance<TCursor, TSlice, TArtifact>;
  io: WorkloadIoPorts<TCursor, TSlice, TArtifact>;
  schedule: { mode: ScheduleMode; intervalMs?: number };
  readControl?: () => Promise<"continue" | "pause" | "cancel">;
  onUnhandledError?: (error: unknown) => void;
  /** Optional observability callback port. */
  obs?: JobKernelObsPort;
};

export type Workload = JobKernel & {
  readonly descriptor: WorkbookDescriptor;
};

export function createWorkload<TCursor, TSlice, TArtifact>(
  options: CreateWorkloadOptions<TCursor, TSlice, TArtifact>,
): Workload {
  const kernel = createJobKernel({
    pipelineKey: options.workbook.descriptor.pipelineKey,
    schedule: options.schedule,
    cursorStore: options.io.cursorStore,
    readControl: options.readControl,
    onUnhandledError: options.onUnhandledError,
    obs: options.obs,
    callbacks: {
      loadSlice: options.io.loadSlice,
      evaluate: options.workbook.evaluate,
      materialize: options.io.materialize,
      emitProgress: options.io.emitProgress,
    },
  });

  return { ...kernel, descriptor: options.workbook.descriptor };
}
