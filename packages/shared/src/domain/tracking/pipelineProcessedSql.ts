/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT SQL-фрагмент — pipeline-точка ещё не обработана трекером.
 *          alias таблицы event_locations: el
 * ---
 */

/** Точка не в trajectory_nodes и не в tracking_pipeline_consumed. */
export const TRACKING_PIPELINE_NOT_PROCESSED_SQL = `
  AND NOT EXISTS (
    SELECT 1 FROM trajectory_nodes tn
    WHERE tn.source_refs @> jsonb_build_array(
      jsonb_build_object('eventLocationId', el.id::text)
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM tracking_pipeline_consumed tpc
    WHERE tpc.event_location_id = el.id
  )`;
