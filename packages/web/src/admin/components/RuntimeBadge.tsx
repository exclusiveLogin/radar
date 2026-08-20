import type { ObsPipelineRuntime } from "@radar/shared";

const RUNTIME_LABELS: Record<ObsPipelineRuntime, string> = {
  legacy: "legacy",
  "runner-platform": "runner-platform",
};

const RUNTIME_VARIANT: Record<ObsPipelineRuntime, "default" | "ok" | "warn"> = {
  legacy: "default",
  "runner-platform": "ok",
};

/** Бейдж runtime pipeline: legacy | runner-platform (из odpRuntime / workload.runtime). */
export function RuntimeBadge({ runtime }: { runtime: ObsPipelineRuntime | null }) {
  if (!runtime) {
    return <span className="ds-muted">—</span>;
  }

  return (
    <span className={`ds-badge ds-badge--${RUNTIME_VARIANT[runtime]}`}>
      {RUNTIME_LABELS[runtime]}
    </span>
  );
}
