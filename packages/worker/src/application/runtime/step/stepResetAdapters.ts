/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Адаптеры StepResetPort поверх существующих wipe/reset use cases.
 * ---
 */
import { TRACKING_RESET_TRUNCATE_SQL } from "@radar/shared";
import { clearIngestOperationalState } from "../../archive/clearIngestOperationalState.js";
import {
  resetGeoEnrichmentPhase,
  wipeGeoPlacesPhase,
} from "../../phases/lifecycle/geoPhase.js";
import type { PhaseOperationalDeps } from "../../phases/phaseOperationalDeps.js";
import { runPipelineOperationalReset } from "../../phases/pipelineOperationalReset.js";
import type { StepResetPort } from "./stepResetPort.js";

async function countRows(
  deps: PhaseOperationalDeps,
  table: string,
): Promise<number> {
  const rows = await deps.operationalSql.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}`,
  );
  return Number(rows[0]?.count ?? 0);
}

/** parse: operational reset parsed/coverage/map. */
export function createParseStepResetPort(deps: PhaseOperationalDeps): StepResetPort {
  return {
    async preview() {
      return {
        work_parse_message: await countRows(deps, "work_parse_message"),
        mat_parse_event: await countRows(deps, "mat_parse_event"),
        log_parse_attempt: await countRows(deps, "log_parse_attempt"),
      };
    },
    async apply() {
      const result = await runPipelineOperationalReset({
        deps,
        enqueueCatchUp: false,
        forceLocks: false,
      });
      return {
        mapPlacesCleared: result.mapPlacesCleared,
        parsedEventsDeleted: result.parsedEventsDeleted,
        parseAttemptsDeleted: result.parseAttemptsDeleted,
        coverageInvalidated: result.coverageInvalidated,
        phaseRunsClosed: result.phaseRunsClosed,
      };
    },
  };
}

/**
 * geo: сброс enrichment (координаты/evidence).
 * wipe places — отдельный destructive path; cascade reset использует soft reset.
 */
export function createGeoStepResetPort(deps: PhaseOperationalDeps): StepResetPort {
  return {
    async preview() {
      const dry = await resetGeoEnrichmentPhase({ deps, dryRun: true });
      return {
        places: await countRows(deps, "places"),
        mat_parse_evidence: await countRows(deps, "mat_parse_evidence"),
        notes: dry.notes?.length ?? 0,
      };
    },
    async apply() {
      const result = await resetGeoEnrichmentPhase({ deps, dryRun: false });
      return result.counts;
    },
  };
}

/** geo wipe catalog places (опциональный тяжёлый handler, не в default cascade). */
export function createGeoWipeStepResetPort(deps: PhaseOperationalDeps): StepResetPort {
  return {
    async preview() {
      const dry = await wipeGeoPlacesPhase({ deps, dryRun: true });
      return {
        places: await countRows(deps, "places"),
        notes: dry.notes?.length ?? 0,
      };
    },
    async apply() {
      const result = await wipeGeoPlacesPhase({ deps, dryRun: false });
      return result.counts;
    },
  };
}

/** tracking: TRUNCATE L1 + watermark. */
export function createTrackingStepResetPort(deps: PhaseOperationalDeps): StepResetPort {
  return {
    async preview() {
      return {
        mat_track: await countRows(deps, "mat_track"),
        mat_track_node: await countRows(deps, "mat_track_node"),
        state_track_consumed: await countRows(deps, "state_track_consumed"),
      };
    },
    async apply() {
      await deps.operationalSql.query(
        `UPDATE job_track_rebuild
         SET status = 'cancelled', finished_at = now()
         WHERE status IN ('running', 'paused')`,
      );
      await deps.operationalSql.query(TRACKING_RESET_TRUNCATE_SQL);
      await deps.operationalSql.query(
        `UPDATE state_track_pipeline
         SET watermark = '{}'::jsonb,
             flow_snapshot = '{"vectors":{},"mass":{}}'::jsonb,
             active_run_id = NULL,
             updated_at = now()
         WHERE id = 'default'`,
      );
      return { truncated: 1, watermarkReset: 1 };
    },
  };
}

/** ingest: cursors / backfill jobs / provider errors. */
export function createIngestStepResetPort(deps: PhaseOperationalDeps): StepResetPort {
  return {
    async preview() {
      return {
        job_ingest_backfill: await countRows(deps, "job_ingest_backfill"),
        state_ingest_cursor: await countRows(deps, "state_ingest_cursor"),
      };
    },
    async apply() {
      const result = await clearIngestOperationalState(deps.operationalSql, {
        includeDomainEvents: false,
      });
      return {
        backfillJobsDeleted: result.backfillJobsDeleted,
        cursorsDeleted: result.cursorsDeleted,
        providersErrorsCleared: result.providersErrorsCleared,
      };
    },
  };
}
