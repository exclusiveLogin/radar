import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { clearOperationalContent } from "../../archive/clearOperationalContent.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/**
 * ingest:wipe — raw и всё производное (parsed, evloc, parse_attempts, карта, ingest cursors).
 * places / geo-каталог не трогаем.
 */
export async function wipeIngestPhase(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  dryRun: boolean;
}): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "ingest",
      action: "wipe",
      dryRun: true,
      counts: {},
      notes: ["Удалит raw_messages, parsed_events, event_locations, parse_attempts, phase_runs, domain_events, ingest cursors/backfill, read-model карты."],
    };
  }

  const r = await clearOperationalContent({
    dataSource: input.dataSource,
    repos: input.repos,
    reason: "ingest:wipe",
  });

  return {
    phase: "ingest",
    action: "wipe",
    dryRun: false,
    counts: {
      raw_messages: r.rawMessagesDeleted,
      parsed_events: r.parsedEventsDeleted,
      parse_attempts: r.parseAttemptsDeleted,
      phase_runs: r.phaseRunsDeleted,
      domain_events: r.domainEventsDeleted,
      place_status_read_model: r.map.placesCleared,
      region_status_read_model: r.map.regionsCleared,
      ingest_cursors: r.ingest.cursorsDeleted,
      ingest_backfill_jobs: r.ingest.backfillJobsDeleted,
      event_evidence: r.eventEvidenceDeleted,
      place_enrichment_jobs: r.placeEnrichmentJobsDeleted,
    },
  };
}

/** ingest:reset — на фазе ingest нет слоя обогащения. */
export function resetIngestPhase(dryRun: boolean): PhaseMutationResult {
  return {
    phase: "ingest",
    action: "reset",
    dryRun,
    counts: {},
    notes: ["Нет операции: ingest не пишет обогащение, только raw."],
  };
}
