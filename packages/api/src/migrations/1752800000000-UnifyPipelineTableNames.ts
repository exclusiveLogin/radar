import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Epic G: 21x RENAME операционных таблиц. @see docs/rfc/adr-020-database-table-naming.md
 * enrichment_queue RENAME пропущен: таблица уже смержена в phase_coverage до Epic G (единая lineage queue).
 */
export class UnifyPipelineTableNames1752800000000 implements MigrationInterface {
  name = "UnifyPipelineTableNames1752800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE raw_messages RENAME TO mat_ingest_raw`);
    await queryRunner.query(`ALTER TABLE raw_message_telegram RENAME TO mat_ingest_raw_tg`);
    await queryRunner.query(`ALTER TABLE ingest_cursors RENAME TO state_ingest_cursor`);
    await queryRunner.query(`ALTER TABLE ingest_backfill_jobs RENAME TO job_ingest_backfill`);
    await queryRunner.query(`ALTER TABLE message_parse_workspace RENAME TO work_parse_message`);
    await queryRunner.query(`ALTER TABLE parsed_events RENAME TO mat_parse_event`);
    await queryRunner.query(`ALTER TABLE parse_attempts RENAME TO log_parse_attempt`);
    await queryRunner.query(`ALTER TABLE event_locations RENAME TO mat_parse_location`);
    await queryRunner.query(`ALTER TABLE event_evidence RENAME TO mat_parse_evidence`);
    await queryRunner.query(`ALTER TABLE phase_coverage RENAME TO queue_parse_coverage`);
    await queryRunner.query(`ALTER TABLE phase_runs RENAME TO log_parse_phase_run`);
    await queryRunner.query(`ALTER TABLE place_enrichment_jobs RENAME TO job_geo_place_enrich`);
    await queryRunner.query(`ALTER TABLE geo_sync_log RENAME TO log_geo_sync`);
    await queryRunner.query(`ALTER TABLE trajectory_tracks RENAME TO mat_track`);
    await queryRunner.query(`ALTER TABLE trajectory_nodes RENAME TO mat_track_node`);
    await queryRunner.query(`ALTER TABLE trajectory_rebuild_runs RENAME TO job_track_rebuild`);
    await queryRunner.query(`ALTER TABLE tracking_pipeline_state RENAME TO state_track_pipeline`);
    await queryRunner.query(`ALTER TABLE tracking_tune_runs RENAME TO job_track_tune`);
    await queryRunner.query(`ALTER TABLE tracking_pipeline_consumed RENAME TO state_track_consumed`);
    await queryRunner.query(`ALTER TABLE domain_events RENAME TO event_outbox`);
    await queryRunner.query(`ALTER TABLE event_subscriptions RENAME TO state_event_subscription`);
    for (const [from, to] of [
      ["trajectory_tracks_profile_status_idx", "mat_track_profile_status_idx"],
      ["trajectory_tracks_last_at_idx", "mat_track_last_at_idx"],
      ["trajectory_nodes_track_seq_idx", "mat_track_node_track_seq_idx"],
      ["trajectory_nodes_occurred_at_idx", "mat_track_node_occurred_at_idx"],
      ["trajectory_rebuild_runs_started_at_idx", "job_track_rebuild_started_at_idx"],
      ["trajectory_rebuild_runs_running_idx", "job_track_rebuild_running_idx"],
    ] as const) {
      await queryRunner.query(`ALTER INDEX IF EXISTS "${from}" RENAME TO "${to}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of [
      ["mat_track_profile_status_idx", "trajectory_tracks_profile_status_idx"],
      ["mat_track_last_at_idx", "trajectory_tracks_last_at_idx"],
      ["mat_track_node_track_seq_idx", "trajectory_nodes_track_seq_idx"],
      ["mat_track_node_occurred_at_idx", "trajectory_nodes_occurred_at_idx"],
      ["job_track_rebuild_started_at_idx", "trajectory_rebuild_runs_started_at_idx"],
      ["job_track_rebuild_running_idx", "trajectory_rebuild_runs_running_idx"],
    ] as const) {
      await queryRunner.query(`ALTER INDEX IF EXISTS "${from}" RENAME TO "${to}"`);
    }
    await queryRunner.query(`ALTER TABLE state_event_subscription RENAME TO event_subscriptions`);
    await queryRunner.query(`ALTER TABLE event_outbox RENAME TO domain_events`);
    await queryRunner.query(`ALTER TABLE state_track_consumed RENAME TO tracking_pipeline_consumed`);
    await queryRunner.query(`ALTER TABLE job_track_tune RENAME TO tracking_tune_runs`);
    await queryRunner.query(`ALTER TABLE state_track_pipeline RENAME TO tracking_pipeline_state`);
    await queryRunner.query(`ALTER TABLE job_track_rebuild RENAME TO trajectory_rebuild_runs`);
    await queryRunner.query(`ALTER TABLE mat_track_node RENAME TO trajectory_nodes`);
    await queryRunner.query(`ALTER TABLE mat_track RENAME TO trajectory_tracks`);
    await queryRunner.query(`ALTER TABLE log_geo_sync RENAME TO geo_sync_log`);
    await queryRunner.query(`ALTER TABLE job_geo_place_enrich RENAME TO place_enrichment_jobs`);
    await queryRunner.query(`ALTER TABLE log_parse_phase_run RENAME TO phase_runs`);
    await queryRunner.query(`ALTER TABLE queue_parse_coverage RENAME TO phase_coverage`);
    await queryRunner.query(`ALTER TABLE mat_parse_evidence RENAME TO event_evidence`);
    await queryRunner.query(`ALTER TABLE mat_parse_location RENAME TO event_locations`);
    await queryRunner.query(`ALTER TABLE log_parse_attempt RENAME TO parse_attempts`);
    await queryRunner.query(`ALTER TABLE mat_parse_event RENAME TO parsed_events`);
    await queryRunner.query(`ALTER TABLE work_parse_message RENAME TO message_parse_workspace`);
    await queryRunner.query(`ALTER TABLE job_ingest_backfill RENAME TO ingest_backfill_jobs`);
    await queryRunner.query(`ALTER TABLE state_ingest_cursor RENAME TO ingest_cursors`);
    await queryRunner.query(`ALTER TABLE mat_ingest_raw_tg RENAME TO raw_message_telegram`);
    await queryRunner.query(`ALTER TABLE mat_ingest_raw RENAME TO raw_messages`);
  }
}
