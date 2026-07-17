import { clearOperationalContent } from "../../archive/clearOperationalContent.js";
import type { PhaseOperationalDeps } from "../phaseOperationalDeps.js";
import type { WipeStepOptions } from "../../archive/wipeStepReporter.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/**
 * ingest:wipe — raw и всё производное (parsed, evloc, log_parse_attempt, карта, ingest cursors).
 * places / geo-каталог не трогаем.
 */
export async function wipeIngestPhase(
  input: {
    deps: PhaseOperationalDeps;
    dryRun: boolean;
  } & WipeStepOptions,
): Promise<PhaseMutationResult> {
  if (input.dryRun) {
    return {
      phase: "ingest",
      action: "wipe",
      dryRun: true,
      counts: {},
      notes: ["Удалит mat_ingest_raw, mat_parse_event, mat_parse_location, log_parse_attempt, log_parse_phase_run, event_outbox, ingest cursors/backfill."],
    };
  }

  const r = await clearOperationalContent({
    deps: input.deps,
    reason: "ingest:wipe",
    onStep: input.onStep,
  });

  return {
    phase: "ingest",
    action: "wipe",
    dryRun: false,
    counts: {
      mat_ingest_raw: r.rawMessagesDeleted,
      mat_parse_event: r.parsedEventsDeleted,
      log_parse_attempt: r.parseAttemptsDeleted,
      log_parse_phase_run: r.phaseRunsDeleted,
      event_outbox: r.domainEventsDeleted,
      state_ingest_cursor: r.ingest.cursorsDeleted,
      job_ingest_backfill: r.ingest.backfillJobsDeleted,
      mat_parse_evidence: r.eventEvidenceDeleted,
      job_geo_place_enrich: r.placeEnrichmentJobsDeleted,
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
