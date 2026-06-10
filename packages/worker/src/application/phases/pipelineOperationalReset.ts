import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { truncateTableCounted } from "../archive/wipeTableSql.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { sortPhasesByOrder } from "./phaseOrder.js";
import { stopAllActivePhaseRuns } from "./stopAllActivePhaseRuns.js";

export const PIPELINE_RESET_REASON = "pipeline:operational-reset";

/** TRUNCATE parsed_events (+ event_locations CASCADE). */
export async function clearParsedArtifacts(dataSource: DataSource): Promise<number> {
  return truncateTableCounted(dataSource, "parsed_events", { cascade: true });
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
    dataSource,
  });
  const map = await mapReset.run(new Date(), PIPELINE_RESET_REASON);

  const parsedEventsDeleted = await clearParsedArtifacts(dataSource);
  const parseAttemptsDeleted = await truncateTableCounted(dataSource, "parse_attempts");

  const allPhaseIds = (await repos.phaseDefinitions.listAll()).map((p) => p.id);
  const coverageInvalidated =
    allPhaseIds.length > 0
      ? await repos.phaseCoverage.invalidateForPhases(allPhaseIds)
      : 0;

  const { phaseRunsClosed, processingReleased: coverageProcessingToPending } =
    await stopAllActivePhaseRuns({
      dataSource,
      repos,
      reason: PIPELINE_RESET_REASON,
    });

  const catchUpByPhase: Record<string, number> = {};
  if (input.enqueueCatchUp !== false) {
    const enabledAuto = sortPhasesByOrder(
      (await repos.phaseDefinitions.listEnabled(undefined, "ingestParse")).filter(
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
    parseAttemptsDeleted,
    coverageInvalidated,
    coverageProcessingToPending,
    phaseRunsClosed,
    catchUpByPhase,
  };
}
