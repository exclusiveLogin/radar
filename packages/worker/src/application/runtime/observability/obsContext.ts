import type { PipelineKey } from "@radar/shared";
import { buildObsHostId } from "../../../infrastructure/config/obsMode.js";

export { buildObsHostId };

/** ISO timestamp для obs write-path. */
export function obsNow(): string {
  return new Date().toISOString();
}

/**
 * SSOT workload_id: `{hostId}:{pipelineKey}` или с суффиксом для phase-specific legacy.
 */
export function buildWorkloadId(
  hostId: string,
  pipelineKey: PipelineKey,
  suffix?: string,
): string {
  return suffix ? `${hostId}:${pipelineKey}:${suffix}` : `${hostId}:${pipelineKey}`;
}

/** SSOT executor_id для worker_threads в ParseWorkerPool. */
export function buildExecutorId(hostId: string, index: number): string {
  return `${hostId}:parse-thread:${index}`;
}
