import type { MigrationInterface, QueryRunner } from "typeorm";

/** История offline auto-tune jobs для tracking pipeline. */
export class TrackingTuneRuns1752200000000 implements MigrationInterface {
  name = "TrackingTuneRuns1752200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tracking_tune_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT NOT NULL CHECK (status IN ('running','done','failed','cancelled')),
        params_in JSONB NOT NULL DEFAULT '{}',
        epochs_done INTEGER NOT NULL DEFAULT 0,
        max_epochs INTEGER NOT NULL DEFAULT 12,
        best_config JSONB,
        best_fitness DOUBLE PRECISION,
        grid JSONB NOT NULL DEFAULT '[]',
        control JSONB NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS tracking_tune_runs_created_at_idx
        ON tracking_tune_runs (created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracking_tune_runs`);
  }
}
