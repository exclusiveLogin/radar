/**
 * Разовая диагностика tracking pipeline (read-only).
 */
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";

const EVENT_AT_SQL = "COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at)";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    workerRole: "tracking",
    bootCaps: ["tracking"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  const ds = runtime.dataSource;
  if (!ds) {
    console.error("Нет dataSource");
    process.exit(1);
  }

  try {
    const [state] = await ds.query(
      `SELECT enabled, watermark, active_run_id, total_candidates, updated_at
       FROM state_track_pipeline WHERE id = 'default'`,
    );

    const [run] = state?.active_run_id
      ? await ds.query(
          `SELECT id, status, mode, started_at, finished_at, stats, error
           FROM job_track_rebuild WHERE id = $1`,
          [state.active_run_id],
        )
      : [null];

    const trackByStatus = await ds.query(
      `SELECT status, COUNT(*)::int AS count FROM mat_track GROUP BY status`,
    );
    const [{ nodes }] = await ds.query(`SELECT COUNT(*)::int AS nodes FROM mat_track_node`);

    const sdCols = await ds.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'status_dictionary' ORDER BY ordinal_position
    `);

    const [{ all_geo }] = await ds.query(`
      SELECT COUNT(*)::int AS all_geo
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
      WHERE el.lat IS NOT NULL AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
    `);

    const [{ target_kinematic }] = await ds.query(`
      SELECT COUNT(*)::int AS target_kinematic
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
      WHERE el.lat IS NOT NULL AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (
          'fixation', 'rocket_threat', 'airspace_restriction',
          'pvo_work', 'pvo_report', 'intercept', 'danger', 'warning'
        )
    `);

    let batchError: string | null = null;
    let batchSize = 0;
    try {
      const { loadPendingTrackingCandidates } = await import(
        "../application/tracking/loadTrackingCandidates.js"
      );
      const batch = await loadPendingTrackingCandidates(ds, {
        until: new Date(),
      });
      batchSize = batch.length;
    } catch (e) {
      batchError = e instanceof Error ? e.message : String(e);
    }

    console.log(
      JSON.stringify(
        {
          pipeline: state,
          activeRun: run,
          tracksByStatus: trackByStatus,
          totalNodes: nodes,
          statusDictionaryColumns: sdCols.map((r: { column_name: string }) => r.column_name),
          pendingLoad: { ok: batchError === null, error: batchError, pendingSize: batchSize },
          candidates: { allWithGeo: all_geo, targetEventTypes: target_kinematic },
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.shutdown?.();
  }
}

void main();
