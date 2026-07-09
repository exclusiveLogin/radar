import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { clearOperationalMapState } from "../../archive/clearOperationalMapState.js";
import { truncateTableCounted } from "../../archive/wipeTableSql.js";
import { clearParsedArtifacts } from "../pipelineOperationalReset.js";
import { stopAllActivePhaseRuns } from "../stopAllActivePhaseRuns.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/**
 * parse:wipe — срез после ingest: raw остаётся, parsed/evloc снимаются.
 */
export async function wipeParsePhase(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  dryRun: boolean;
}): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "parse",
      action: "wipe",
      dryRun: true,
      counts: {},
      notes: [
        "TRUNCATE work_parse_message, mat_parse_event (+ mat_parse_location), log_parse_attempt, mat_parse_evidence, job_geo_place_enrich.",
        "mat_ingest_raw не трогает.",
      ],
    };
  }

  await stopAllActivePhaseRuns({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: "parse:wipe",
  });

  await clearOperationalMapState(input.dataSource, "parse:wipe");
  const parsedEvents = await clearParsedArtifacts(input.dataSource);
  const parseAttempts = await truncateTableCounted(input.dataSource, "log_parse_attempt");
  const eventEvidence = await truncateTableCounted(input.dataSource, "mat_parse_evidence");
  const enrichmentJobs = await truncateTableCounted(
    input.dataSource,
    "job_geo_place_enrich",
  );

  return {
    phase: "parse",
    action: "wipe",
    dryRun: false,
    counts: {
      mat_parse_event: parsedEvents,
      log_parse_attempt: parseAttempts,
      mat_parse_evidence: eventEvidence,
      job_geo_place_enrich: enrichmentJobs,
    },
  };
}

/** parse:reset — обогащения на фазе parse нет (только структурный разбор). */
export function resetParsePhase(dryRun: boolean): PhaseMutationResult {
  return {
    phase: "parse",
    action: "reset",
    dryRun,
    counts: {},
    notes: ["Нет операции: parse не пишет координаты/trust, только факты и evloc."],
  };
}
