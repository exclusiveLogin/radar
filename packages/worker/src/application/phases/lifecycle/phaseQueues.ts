import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { stopAllActivePhaseRuns } from "../stopAllActivePhaseRuns.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

export type PhaseQueueScope = "ingest" | "geo" | "all";

/**
 * phase:*:clear — только очереди и активные runs, без удаления raw/places.
 */
export async function clearPhaseQueues(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  scope: PhaseQueueScope;
  dryRun: boolean;
}): Promise<PhaseMutationResult> {
  const phaseLabel = `phase:${input.scope}`;

  if (input.dryRun) {
    const notes =
      input.scope === "ingest"
        ? ["Очистит phase_coverage и cancel phase_runs (ingestParse)."]
        : input.scope === "geo"
          ? ["Очистит place_enrichment_jobs (pending/processing) и cancel phase_runs."]
          : ["Очистит ingest coverage + geo jobs + cancel всех phase_runs."];

    return {
      phase: phaseLabel,
      action: "clear",
      dryRun: true,
      counts: {},
      notes,
    };
  }

  const clearGeo = input.scope === "geo" || input.scope === "all";
  const clearIngest = input.scope === "ingest" || input.scope === "all";

  const ingestPhaseIds = clearIngest
    ? (await input.repos.phaseDefinitions.listAll())
        .filter((p) => p.scope === "ingestParse")
        .map((p) => p.id)
    : [];

  const toStop = await stopAllActivePhaseRuns({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: `${phaseLabel}:clear`,
    ingestPhaseIds,
    clearGeoJobs: clearGeo,
  });

  let queueCleared = toStop.queueCleared;
  if (input.scope === "geo") {
    queueCleared = 0;
  }

  return {
    phase: phaseLabel,
    action: "clear",
    dryRun: false,
    counts: {
      phase_runs_canceled: toStop.phaseRunsClosed,
      phase_coverage_cleared: queueCleared,
      place_enrichment_jobs_cleared: toStop.geoJobsCleared,
    },
  };
}
