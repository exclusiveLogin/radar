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
        ? ["Очистит queue_parse_coverage и cancel log_parse_phase_run (ingestParse)."]
        : input.scope === "geo"
          ? ["Очистит job_geo_place_enrich (pending/processing) и cancel log_parse_phase_run."]
          : ["Очистит ingest coverage + geo jobs + cancel всех log_parse_phase_run."];

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
      log_parse_phase_run_canceled: toStop.phaseRunsClosed,
      queue_parse_coverage_cleared: queueCleared,
      job_geo_place_enrich_cleared: toStop.geoJobsCleared,
    },
  };
}
