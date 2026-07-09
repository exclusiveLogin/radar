/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT SQL-фрагмент — pipeline-точка ещё не обработана трекером.
 *          alias таблицы mat_parse_location: el
 * ---
 */

/** Точка не в mat_track_node и не в state_track_consumed. */
export const TRACKING_PIPELINE_NOT_PROCESSED_SQL = `
  AND NOT EXISTS (
    SELECT 1 FROM mat_track_node tn
    WHERE tn.source_refs @> jsonb_build_array(
      jsonb_build_object('eventLocationId', el.id::text)
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM state_track_consumed tpc
    WHERE tpc.event_location_id = el.id
  )`;
