import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { truncateTableCounted } from "../archive/wipeTableSql.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { sortPhasesByOrder } from "./phaseOrder.js";
import { stopAllActivePhaseRuns } from "./stopAllActivePhaseRuns.js";

export const PIPELINE_RESET_REASON = "pipeline:operational-reset";

/** TRUNCATE work_parse_message + mat_parse_event (+ CASCADE). Контур rebuild/reparse. @see ../parse/parseWorkspaceRunModes.ts */
export async function clearParseLayerArtifacts(
  dataSource: DataSource,
  options: { forceLocks?: boolean } = {},
): Promise<{
  workspacesDeleted: number;
  parsedEventsDeleted: number;
}> {
  const forceLocks = options.forceLocks !== false;
  const truncateOpts = { forceLocks };
  const workspacesDeleted = await truncateTableCounted(
    dataSource,
    "work_parse_message",
    truncateOpts,
  );
  const parsedEventsDeleted = await truncateTableCounted(dataSource, "mat_parse_event", {
    cascade: true,
    ...truncateOpts,
  });
  return { workspacesDeleted, parsedEventsDeleted };
}

/** @deprecated Используйте clearParseLayerArtifacts */
export async function clearParsedArtifacts(dataSource: DataSource): Promise<number> {
  const result = await clearParseLayerArtifacts(dataSource);
  return result.parsedEventsDeleted;
}

export type PipelineOperationalResetInput = {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  /** После сброса — pending catch-up для enabled eager+scheduled (для worker:dev). */
  enqueueCatchUp?: boolean;
  /** По умолчанию true; false — не рвать dev/API сессии (запуск из админки). */
  forceLocks?: boolean;
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
 * Не трогает: mat_ingest_raw, ingest_*, channels, places/regions (справочник), phase_definitions.
 */
export async function runPipelineOperationalReset(
  input: PipelineOperationalResetInput,
): Promise<PipelineOperationalResetResult> {
  const { dataSource, repos } = input;
  const truncateOpts = { forceLocks: input.forceLocks !== false };

  const mapReset = new MapStateFullReset({
    dataSource,
  });
  const map = await mapReset.run(new Date(), PIPELINE_RESET_REASON);

  const { parsedEventsDeleted } = await clearParseLayerArtifacts(dataSource, truncateOpts);
  const parseAttemptsDeleted = await truncateTableCounted(
    dataSource,
    "log_parse_attempt",
    truncateOpts,
  );

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
