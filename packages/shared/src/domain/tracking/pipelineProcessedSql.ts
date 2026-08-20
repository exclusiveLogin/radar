/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT SQL-фрагмент — pipeline-точка ещё не обработана трекером.
 *          alias таблицы mat_parse_location: el
 * ---
 */

/**
 * Точка не в mat_track_node и не в state_track_consumed.
 *
 * source_refs развёрнут через LATERAL, а не сопоставлен через `@> jsonb_build_array(...)`:
 * искомое значение зависит от внешней строки, поэтому GIN не применялся и планировщик брал
 * nested loop — миллионы jsonb-сравнений (~13 c на архиве). Развёрнутая форма даёт hash anti join.
 */
export const TRACKING_PIPELINE_NOT_PROCESSED_SQL = `
  AND NOT EXISTS (
    SELECT 1
    FROM mat_track_node tn
    CROSS JOIN LATERAL jsonb_array_elements(tn.source_refs) AS src(ref)
    WHERE src.ref->>'eventLocationId' = el.id::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM state_track_consumed tpc
    WHERE tpc.event_location_id = el.id
  )`;
