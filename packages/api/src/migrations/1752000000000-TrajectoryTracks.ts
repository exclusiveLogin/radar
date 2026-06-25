import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Таблицы пайплайна треков: L1 (tracks/nodes), прогресс rebuild и watermark.
 */
export class TrajectoryTracks1752000000000 implements MigrationInterface {
  name = "TrajectoryTracks1752000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE trajectory_tracks (
        id UUID PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('active','closed','stale')),
        threat_profile TEXT NOT NULL,
        first_at TIMESTAMPTZ NOT NULL,
        last_at TIMESTAMPTZ NOT NULL,
        last_lat DOUBLE PRECISION NOT NULL,
        last_lon DOUBLE PRECISION NOT NULL,
        velocity_ms DOUBLE PRECISION,
        bearing_deg DOUBLE PRECISION,
        node_count INTEGER NOT NULL DEFAULT 0,
        total_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
        rebuild_gen TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX trajectory_tracks_profile_status_idx ON trajectory_tracks (threat_profile, status);
      CREATE INDEX trajectory_tracks_last_at_idx ON trajectory_tracks (last_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE trajectory_nodes (
        id UUID PRIMARY KEY,
        track_id UUID NOT NULL REFERENCES trajectory_tracks(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        place_id UUID,
        mode TEXT NOT NULL CHECK (mode IN ('correct','attach_only')),
        kalman_state JSONB,
        source_refs JSONB NOT NULL DEFAULT '[]'
      );
      CREATE INDEX trajectory_nodes_track_seq_idx ON trajectory_nodes (track_id, seq);
      CREATE INDEX trajectory_nodes_occurred_at_idx ON trajectory_nodes (occurred_at);
    `);

    await queryRunner.query(`
      CREATE TABLE trajectory_rebuild_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL CHECK (status IN ('running','paused','done','failed','cancelled')),
        mode TEXT NOT NULL CHECK (mode IN ('incremental','full_rebuild')),
        since TIMESTAMPTZ NOT NULL,
        until TIMESTAMPTZ NOT NULL,
        rebuild_gen TEXT NOT NULL,
        stats JSONB NOT NULL DEFAULT '{}',
        checkpoint JSONB,
        control JSONB DEFAULT '{}',
        error TEXT
      );
      CREATE INDEX trajectory_rebuild_runs_started_at_idx ON trajectory_rebuild_runs (started_at DESC);
      CREATE INDEX trajectory_rebuild_runs_running_idx ON trajectory_rebuild_runs (status) WHERE status = 'running';
    `);

    await queryRunner.query(`
      CREATE TABLE tracking_pipeline_state (
        id TEXT PRIMARY KEY DEFAULT 'default',
        enabled BOOLEAN NOT NULL DEFAULT false,
        watermark JSONB NOT NULL DEFAULT '{}',
        config JSONB NOT NULL DEFAULT '{}',
        active_run_id UUID REFERENCES trajectory_rebuild_runs(id),
        total_candidates BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO tracking_pipeline_state (id) VALUES ('default');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracking_pipeline_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS trajectory_rebuild_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS trajectory_nodes`);
    await queryRunner.query(`DROP TABLE IF EXISTS trajectory_tracks`);
  }
}
