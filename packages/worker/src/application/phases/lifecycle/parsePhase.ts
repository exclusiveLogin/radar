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
        "TRUNCATE parsed_events (+ event_locations), parse_attempts, event_evidence, place_enrichment_jobs.",
        "raw_messages не трогает.",
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
  const parseAttempts = await truncateTableCounted(input.dataSource, "parse_attempts");
  const eventEvidence = await truncateTableCounted(input.dataSource, "event_evidence");
  const enrichmentJobs = await truncateTableCounted(
    input.dataSource,
    "place_enrichment_jobs",
  );

  return {
    phase: "parse",
    action: "wipe",
    dryRun: false,
    counts: {
      parsed_events: parsedEvents,
      parse_attempts: parseAttempts,
      event_evidence: eventEvidence,
      place_enrichment_jobs: enrichmentJobs,
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
