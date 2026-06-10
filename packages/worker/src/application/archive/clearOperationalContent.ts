import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { stopAllActivePhaseRuns } from "../phases/stopAllActivePhaseRuns.js";
import { clearIngestOperationalState } from "./clearIngestOperationalState.js";
import { clearOperationalMapState } from "./clearOperationalMapState.js";
import { clearRawArchive } from "./clearRawArchive.js";
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
  forceLocks: ctx.forceLocks,
});

/**
 * Полная очистка операционного контента: raw → parse → карта → очереди фаз → outbox.
 */
export async function clearOperationalContent(
  input: {
    dataSource: DataSource;
    repos: WorkerDbRepositories;
    reason?: string;
  } & WipeStepOptions,
): Promise<ClearOperationalContentResult> {
  const reason = input.reason ?? CLEAR_OPERATIONAL_CONTENT_REASON;
  const { dataSource, repos } = input;

  let phaseRunsStopped = 0;
  let queueCleared = 0;
  await runWipeStep(input, "остановка phase_runs + очередей", async () => {
    input.log?.detail("cancel active phase_runs, clear phase_coverage + geo jobs");
    const stopped = await stopAllActivePhaseRuns({
      dataSource,
      repos,
      reason,
    });
    phaseRunsStopped = stopped.phaseRunsClosed;
    queueCleared = stopped.queueCleared + stopped.geoJobsCleared;
    input.log?.detail(
      `остановлено: phase_runs=${stopped.phaseRunsClosed}, ingest_queue=${stopped.queueCleared}, geo_jobs=${stopped.geoJobsCleared}`,
    );
    return phaseRunsStopped + queueCleared;
  });

  let map = { placesCleared: 0, regionsCleared: 0 };
  await runWipeStep(input, "read-model карты (TRUNCATE)", async () => {
    map = await clearOperationalMapState(dataSource, reason, truncateOpts(input));
    return -1;
  });

  const parsedEventsDeleted = await runWipeStep(
    input,
    "parsed_events + evloc (TRUNCATE CASCADE)",
    () =>
      truncateTableCounted(dataSource, "parsed_events", {
        cascade: true,
        ...truncateOpts(input),
      }),
  );

  const parseAttemptsDeleted = await runWipeStep(input, "parse_attempts", () =>
    truncateTableCounted(dataSource, "parse_attempts", truncateOpts(input)),
  );

  const eventEvidenceDeleted = await runWipeStep(input, "event_evidence", () =>
    truncateTableCounted(dataSource, "event_evidence", truncateOpts(input)),
  );

  const placeEnrichmentJobsDeleted = await runWipeStep(
    input,
    "place_enrichment_jobs",
    () => truncateTableCounted(dataSource, "place_enrichment_jobs", truncateOpts(input)),
  );

  const phaseRunsDeleted = await runWipeStep(input, "phase_runs", () =>
    truncateTableCounted(dataSource, "phase_runs", truncateOpts(input)),
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
    input.log?.detail("TRUNCATE ingest_backfill_jobs, ingest_cursors; clear provider errors");
    ingest = await clearIngestOperationalState(dataSource, {
      includeDomainEvents: false,
      log: input.log,
    });
    input.log?.detail(
      `ingest: jobs=${ingest.backfillJobsDeleted}, cursors=${ingest.cursorsDeleted}, provider_errors_cleared=${ingest.providersErrorsCleared}`,
    );
    return ingest.cursorsDeleted + ingest.backfillJobsDeleted;
  });

  domainEventsDeleted = await runWipeStep(input, "domain_events", () =>
    truncateTableCounted(dataSource, "domain_events", truncateOpts(input)),
  );
  ingest.domainEventsDeleted = domainEventsDeleted;

  const rawMessagesDeleted = await runWipeStep(input, "raw_messages", async () => {
    input.log?.detail("TRUNCATE raw_messages CASCADE (force, parsed уже пуст)");
    const raw = await clearRawArchive(dataSource, { force: true, log: input.log });
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
