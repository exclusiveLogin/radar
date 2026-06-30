import type { TrackingStatusResponse } from "@radar/shared";

/** Pipeline в фазе накопления/сведения — показываем segment_only пунктиром. */
export function resolveTracksPipelineActive(
  status: TrackingStatusResponse | null | undefined,
): boolean {
  if (!status?.enabled) return false;

  const code = status.pipelineStatus.code;
  if (code === "running" || code === "waiting") return true;
  if ((status.pipelineStatus.remainingCandidates ?? 0) > 0) return true;

  const run = status.activeRun;
  return run?.status === "running" || run?.status === "paused";
}
