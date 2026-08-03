import { waitForTableLocksIdle } from "../archive/waitForTableLocksIdle.js";
import {
  truncateTableCounted,
  WipeTableLockError,
  type TruncateOptions,
} from "../archive/wipeTableSql.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { sortPhasesByOrder } from "./phaseOrder.js";
import type { PhaseOperationalDeps } from "./phaseOperationalDeps.js";
import type { OperationalSql } from "./operationalSql.port.js";
import { withSoftTruncateRetry } from "./softTruncateRetry.js";
import { stopAllActivePhaseRuns } from "./stopAllActivePhaseRuns.js";

export const PIPELINE_RESET_REASON = "pipeline:operational-reset";

const SOFT_TRUNCATE_LOCK_TIMEOUT_MS = 5_000;
const SOFT_IDLE_WAIT_MS = 30_000;
const PARSE_RESET_TABLES = [
  "work_parse_message",
  "mat_parse_event",
  "mat_parse_location",
  "log_parse_attempt",
] as const;

/** TRUNCATE work_parse_message + mat_parse_event (+ CASCADE). Контур rebuild/reparse. @see ../parse/parseWorkspaceRunModes.ts */
export async function clearParseLayerArtifacts(
  sql: OperationalSql,
  options: { forceLocks?: boolean; lockTimeoutMs?: number } = {},
): Promise<{
  workspacesDeleted: number;
  parsedEventsDeleted: number;
}> {
  const forceLocks = options.forceLocks !== false;
  const truncateOpts: TruncateOptions = {
    forceLocks,
    lockTimeoutMs: options.lockTimeoutMs,
  };
  const workspacesDeleted = await truncateTableCounted(
    sql,
    "work_parse_message",
    truncateOpts,
  );
  const parsedEventsDeleted = await truncateTableCounted(sql, "mat_parse_event", {
    cascade: true,
    ...truncateOpts,
  });
  return { workspacesDeleted, parsedEventsDeleted };
}

/** @deprecated Используйте clearParseLayerArtifacts */
export async function clearParsedArtifacts(sql: OperationalSql): Promise<number> {
  const result = await clearParseLayerArtifacts(sql);
  return result.parsedEventsDeleted;
}

export type PipelineOperationalResetInput = {
  deps: PhaseOperationalDeps;
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
  const { operationalSql } = input.deps;
  const forceLocks = input.forceLocks !== false;
  const truncateOpts: TruncateOptions = {
    forceLocks,
    lockTimeoutMs: forceLocks ? undefined : SOFT_TRUNCATE_LOCK_TIMEOUT_MS,
  };

  // Сначала закрываем active runs: иначе worker держит lock на parse-таблицах при TRUNCATE.
  const { phaseRunsClosed, processingReleased: coverageProcessingToPending } =
    await stopAllActivePhaseRuns({
      deps: input.deps,
      reason: PIPELINE_RESET_REASON,
    });

  const mapReset = new MapStateFullReset({
    operationalSql,
  });
  const map = await mapReset.run(new Date(), PIPELINE_RESET_REASON);

  if (!forceLocks) {
    // Best-effort: не валим wipe, если краткий SELECT ещё висит — дальше soft-retry TRUNCATE.
    try {
      await waitForTableLocksIdle(operationalSql, [...PARSE_RESET_TABLES], {
        timeoutMs: SOFT_IDLE_WAIT_MS,
      });
    } catch (error) {
      if (!(error instanceof WipeTableLockError)) throw error;
      console.warn(
        `[pipeline-reset] tables still locked after ${SOFT_IDLE_WAIT_MS}ms — continue soft truncate`,
        error.message,
      );
    }
  }

  const { parsedEventsDeleted } = await withSoftTruncateRetry(forceLocks, () =>
    clearParseLayerArtifacts(operationalSql, truncateOpts),
  );
  const parseAttemptsDeleted = await withSoftTruncateRetry(forceLocks, () =>
    truncateTableCounted(operationalSql, "log_parse_attempt", truncateOpts),
  );

  const allPhaseIds = (await input.deps.phaseDefinitions.listAll()).map((p) => p.id);
  const coverageInvalidated =
    allPhaseIds.length > 0
      ? await input.deps.phaseCoverage.invalidateForPhases(allPhaseIds)
      : 0;

  const catchUpByPhase: Record<string, number> = {};
  if (input.enqueueCatchUp !== false) {
    const enabledAuto = sortPhasesByOrder(
      (await input.deps.phaseDefinitions.listEnabled(undefined, "ingestParse")).filter(
        (p) => p.trigger === "eager" || p.trigger === "scheduled",
      ),
    );
    for (const phase of enabledAuto) {
      const { enqueued } = await input.deps.phaseCoverage.enqueueCatchUp(phase.id);
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
