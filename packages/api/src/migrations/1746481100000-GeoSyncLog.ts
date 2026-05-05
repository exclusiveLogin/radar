import type { MigrationInterface, QueryRunner } from "typeorm";

export class GeoSyncLog1746481100000 implements MigrationInterface {
  name = "GeoSyncLog1746481100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE geo_sync_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        target text NOT NULL CHECK (target IN ('regions', 'places', 'aliases', 'all')),
        source_id text,
        source_revision text,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        status text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'aborted')) DEFAULT 'running',
        counts jsonb NOT NULL DEFAULT '{}'::jsonb,
        diff_sample jsonb,
        errors jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_geo_sync_log_target_started ON geo_sync_log(target, started_at DESC);
      CREATE INDEX idx_geo_sync_log_status ON geo_sync_log(status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_geo_sync_log_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_geo_sync_log_target_started`);
    await queryRunner.query(`DROP TABLE IF EXISTS geo_sync_log`);
  }
}
