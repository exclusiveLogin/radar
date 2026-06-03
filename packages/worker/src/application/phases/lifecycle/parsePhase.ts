import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { clearOperationalMapState } from "../../archive/clearOperationalMapState.js";
import { clearParsedArtifacts } from "../pipelineOperationalReset.js";
import { stopAllActivePhaseRuns } from "../stopAllActivePhaseRuns.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/**
 * parse:wipe — срез после ingest: raw остаётся, parsed/evloc/read-model снимаются.
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
        "Удалит parsed_events (+ event_locations), parse_attempts, event_evidence, place_enrichment_jobs, read-model карты.",
        "raw_messages не трогает.",
      ],
    };
  }

  await stopAllActivePhaseRuns({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: "parse:wipe",
  });

  const map = await clearOperationalMapState(input.dataSource, "parse:wipe");
  const parsedEvents = await clearParsedArtifacts(input.dataSource);

  const parseAttemptRows = (await input.dataSource.query(
    `DELETE FROM parse_attempts RETURNING id`,
  )) as Array<{ id: string }>;

  const evidenceRows = (await input.dataSource.query(
    `DELETE FROM event_evidence RETURNING id`,
  )) as Array<{ id: string }>;

  const jobsRows = (await input.dataSource.query(
    `DELETE FROM place_enrichment_jobs RETURNING id`,
  )) as Array<{ id: string }>;

  return {
    phase: "parse",
    action: "wipe",
    dryRun: false,
    counts: {
      parsed_events: parsedEvents,
      parse_attempts: parseAttemptRows.length,
      event_evidence: evidenceRows.length,
      place_enrichment_jobs: jobsRows.length,
      place_status_read_model: map.placesCleared,
      region_status_read_model: map.regionsCleared,
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
