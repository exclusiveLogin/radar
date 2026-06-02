import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { stopAllActivePhaseRuns } from "../phases/stopAllActivePhaseRuns.js";
import { clearIngestOperationalState } from "./clearIngestOperationalState.js";
import { clearOperationalMapState } from "./clearOperationalMapState.js";
import { clearRawArchive } from "./clearRawArchive.js";

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

/**
 * Полная очистка операционного контента: raw → parse → карта → очереди фаз → outbox.
 * Не трогает: channels, ingest_providers/bindings, regions/places (справочник), phase_definitions, status_dictionary.
 */
export async function clearOperationalContent(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  reason?: string;
}): Promise<ClearOperationalContentResult> {
  const reason = input.reason ?? CLEAR_OPERATIONAL_CONTENT_REASON;
  const { dataSource, repos } = input;

  const { phaseRunsClosed: phaseRunsStopped, queueCleared } = await stopAllActivePhaseRuns({
    dataSource,
    repos,
    reason,
  });

  const map = await clearOperationalMapState(dataSource, reason);

  const parsedRows = (await dataSource.query(
    `DELETE FROM parsed_events RETURNING id`,
  )) as Array<{ id: string }>;

  const parseAttemptRows = (await dataSource.query(
    `DELETE FROM parse_attempts RETURNING id`,
  )) as Array<{ id: string }>;

  const evidenceRows = (await dataSource.query(
    `DELETE FROM event_evidence RETURNING id`,
  )) as Array<{ id: string }>;

  const jobsRows = (await dataSource.query(
    `DELETE FROM place_enrichment_jobs RETURNING id`,
  )) as Array<{ id: string }>;

  const phaseRunRows = (await dataSource.query(
    `DELETE FROM phase_runs RETURNING id`,
  )) as Array<{ id: string }>;

  const domainRows = (await dataSource.query(
    `DELETE FROM domain_events RETURNING id`,
  )) as Array<{ id: string }>;

  const ingest = await clearIngestOperationalState(dataSource, {
    includeDomainEvents: false,
  });

  const raw = await clearRawArchive(dataSource, { force: true });

  return {
    phaseRunsStopped,
    queueCleared,
    phaseRunsDeleted: phaseRunRows.length,
    map,
    parsedEventsDeleted: parsedRows.length,
    parseAttemptsDeleted: parseAttemptRows.length,
    eventEvidenceDeleted: evidenceRows.length,
    placeEnrichmentJobsDeleted: jobsRows.length,
    domainEventsDeleted: domainRows.length,
    ingest,
    rawMessagesDeleted: raw.rawMessagesDeleted,
  };
}
