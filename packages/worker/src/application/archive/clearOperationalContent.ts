import { stopAllActivePhaseRuns } from "../phases/stopAllActivePhaseRuns.js";
import type { PhaseOperationalDeps } from "../phases/phaseOperationalDeps.js";
import { clearIngestOperationalState } from "./clearIngestOperationalState.js";
import { clearOperationalMapState } from "./clearOperationalMapState.js";
import { clearRawArchive } from "./clearRawArchive.js";
import { terminateOtherDatabaseBackends } from "./wipeDbLocks.js";
import { truncateTableCounted } from "./wipeTableSql.js";
import { runWipeStep, type WipeStepOptions } from "./wipeStepReporter.js";

export const CLEAR_OPERATIONAL_CONTENT_REASON = "clear:archive";

export type ClearOperationalContentResult = {
  phaseRunsStopped: number;
  queueCleared: number;
  phaseRunsDeleted: number;
  map: Awaited<ReturnType<typeof clearOperationalMapState>>;
  parsedEventsDeleted: number;
  parseAttemptsDeleted: number;
  eventEvidenceDeleted: number;
  placeEnrichmentJobsDeleted: number;
  domainEventsDeleted: number;
  ingest: Awaited<ReturnType<typeof clearIngestOperationalState>>;
  rawMessagesDeleted: number;
};

const truncateOpts = (ctx: WipeStepOptions) => ({
  log: ctx.log,
  /** По умолчанию true — TRUNCATE retry через pg_terminate_backend (как system wipe). */
  forceLocks: ctx.forceLocks !== false,
});

/**
 * Полная очистка операционного контента: raw → parse → карта → очереди фаз → outbox.
 */
export async function clearOperationalContent(
  input: {
    deps: PhaseOperationalDeps;
    reason?: string;
  } & WipeStepOptions,
): Promise<ClearOperationalContentResult> {
  const reason = input.reason ?? CLEAR_OPERATIONAL_CONTENT_REASON;
  const { operationalSql } = input.deps;
  const forceLocks = input.forceLocks !== false;

  if (forceLocks) {
    await runWipeStep(input, "закрытие прочих подключений к БД", async () => {
      input.log?.detail("pg_terminate_backend для dev/API/worker (не текущая сессия)");
      return terminateOtherDatabaseBackends(operationalSql, input.log);
    });
  }

  let phaseRunsStopped = 0;
  let queueCleared = 0;
  await runWipeStep(input, "остановка log_parse_phase_run + очередей", async () => {
    input.log?.detail("cancel active log_parse_phase_run, clear queue_parse_coverage + geo jobs");
    const stopped = await stopAllActivePhaseRuns({
      deps: input.deps,
      reason,
    });
    phaseRunsStopped = stopped.phaseRunsClosed;
    queueCleared = stopped.queueCleared + stopped.geoJobsCleared;
    input.log?.detail(
      `остановлено: log_parse_phase_run=${stopped.phaseRunsClosed}, ingest_queue=${stopped.queueCleared}, geo_jobs=${stopped.geoJobsCleared}`,
    );
    return phaseRunsStopped + queueCleared;
  });

  let map = { placesCleared: 0, regionsCleared: 0 };
  await runWipeStep(input, "map-state (no-op, facts via mat_parse_event wipe)", async () => {
    map = await clearOperationalMapState(operationalSql, reason, truncateOpts(input));
    return -1;
  });

  const parsedEventsDeleted = await runWipeStep(
    input,
    "mat_parse_event + evloc (TRUNCATE CASCADE)",
    () =>
      truncateTableCounted(operationalSql, "mat_parse_event", {
        cascade: true,
        ...truncateOpts(input),
      }),
  );

  const parseAttemptsDeleted = await runWipeStep(input, "log_parse_attempt", () =>
    truncateTableCounted(operationalSql, "log_parse_attempt", truncateOpts(input)),
  );

  const eventEvidenceDeleted = await runWipeStep(input, "mat_parse_evidence", () =>
    truncateTableCounted(operationalSql, "mat_parse_evidence", truncateOpts(input)),
  );

  const placeEnrichmentJobsDeleted = await runWipeStep(
    input,
    "job_geo_place_enrich",
    () => truncateTableCounted(operationalSql, "job_geo_place_enrich", truncateOpts(input)),
  );

  const phaseRunsDeleted = await runWipeStep(input, "log_parse_phase_run", () =>
    truncateTableCounted(operationalSql, "log_parse_phase_run", truncateOpts(input)),
  );

  let ingest = {
    backfillJobsCanceled: 0,
    backfillJobsDeleted: 0,
    cursorsDeleted: 0,
    providersErrorsCleared: 0,
    domainEventsDeleted: 0,
  };
  let domainEventsDeleted = 0;
  await runWipeStep(input, "ingest cursors/backfill", async () => {
    input.log?.detail("TRUNCATE job_ingest_backfill, state_ingest_cursor; clear provider errors");
    ingest = await clearIngestOperationalState(operationalSql, {
      includeDomainEvents: false,
      log: input.log,
    });
    input.log?.detail(
      `ingest: jobs=${ingest.backfillJobsDeleted}, cursors=${ingest.cursorsDeleted}, provider_errors_cleared=${ingest.providersErrorsCleared}`,
    );
    return ingest.cursorsDeleted + ingest.backfillJobsDeleted;
  });

  domainEventsDeleted = await runWipeStep(input, "event_outbox", () =>
    truncateTableCounted(operationalSql, "event_outbox", truncateOpts(input)),
  );
  ingest.domainEventsDeleted = domainEventsDeleted;

  const rawMessagesDeleted = await runWipeStep(input, "mat_ingest_raw", async () => {
    input.log?.detail("TRUNCATE mat_ingest_raw CASCADE (force, parsed уже пуст)");
    const raw = await clearRawArchive(operationalSql, { force: true, log: input.log });
    return raw.rawMessagesDeleted;
  });

  return {
    phaseRunsStopped,
    queueCleared,
    phaseRunsDeleted,
    map,
    parsedEventsDeleted,
    parseAttemptsDeleted,
    eventEvidenceDeleted,
    placeEnrichmentJobsDeleted,
    domainEventsDeleted,
    ingest,
    rawMessagesDeleted,
  };
}
