import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { sortPhasesByOrder } from "./phaseOrder.js";

export const PIPELINE_RESET_REASON = "pipeline:operational-reset";

/** Удаляет результаты parse/enrich (архив raw_messages не трогает). */
export async function clearParsedArtifacts(dataSource: DataSource): Promise<number> {
  const rows = (await dataSource.query(
    `DELETE FROM parsed_events RETURNING id`,
  )) as Array<{ id: string }>;
  return rows.length;
}

export type PipelineOperationalResetInput = {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  /** После сброса — pending catch-up для enabled eager+scheduled (для worker:dev). */
  enqueueCatchUp?: boolean;
};

export type PipelineOperationalResetResult = {
  mapPlacesCleared: number;
  mapRegionsGrey: number;
  parsedEventsDeleted: number;
  parseAttemptsDeleted: number;
  coverageInvalidated: number;
  coverageProcessingToPending: number;
  phaseRunsClosed: number;
  catchUpByPhase: Record<string, number>;
};

/**
 * Сброс операционного слоя: карта, parsed, очереди фаз, зависшие runs.
 * Не трогает: raw_messages, ingest_*, channels, places/regions (справочник), phase_definitions.
 */
export async function runPipelineOperationalReset(
  input: PipelineOperationalResetInput,
): Promise<PipelineOperationalResetResult> {
  const { dataSource, repos } = input;

  const mapReset = new MapStateFullReset({
    regionState: repos.regionState,
    placeStatus: repos.placeStatus,
    regions: repos.regions,
  });
  const map = await mapReset.run(new Date(), PIPELINE_RESET_REASON);

  const parsedEventsDeleted = await clearParsedArtifacts(dataSource);

  const parseAttemptRows = (await dataSource.query(
    `DELETE FROM parse_attempts RETURNING id`,
  )) as Array<{ id: string }>;

  const allPhaseIds = (await repos.phaseDefinitions.listAll()).map((p) => p.id);
  const coverageInvalidated =
    allPhaseIds.length > 0
      ? await repos.phaseCoverage.invalidateForPhases(allPhaseIds)
      : 0;

  let coverageProcessingToPending = 0;
  for (const phaseId of allPhaseIds) {
    coverageProcessingToPending += await repos.phaseCoverage.resetProcessingForPhase(phaseId);
  }

  const phaseRunRows = (await dataSource.query(
    `UPDATE phase_runs SET status = 'canceled', finished_at = now(),
       error = COALESCE(error, $1), updated_at = now()
     WHERE status IN ('running', 'paused', 'pending')
     RETURNING id`,
    [PIPELINE_RESET_REASON],
  )) as Array<{ id: string }>;

  const catchUpByPhase: Record<string, number> = {};
  if (input.enqueueCatchUp !== false) {
    const enabledAuto = sortPhasesByOrder(
      (await repos.phaseDefinitions.listEnabled()).filter(
        (p) => p.trigger === "eager" || p.trigger === "scheduled",
      ),
    );
    for (const phase of enabledAuto) {
      const { enqueued } = await repos.phaseCoverage.enqueueCatchUp(phase.id);
      catchUpByPhase[phase.id] = enqueued;
    }
  }

  return {
    mapPlacesCleared: map.placesCleared,
    mapRegionsGrey: map.regionsGrey,
    parsedEventsDeleted,
    parseAttemptsDeleted: parseAttemptRows.length,
    coverageInvalidated,
    coverageProcessingToPending,
    phaseRunsClosed: phaseRunRows.length,
    catchUpByPhase,
  };
}
