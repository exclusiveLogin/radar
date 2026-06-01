import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Удаление legacy JobDaemon (job_definitions / job_runs).
 * Обогащение и расписание — только phase_definitions + PhaseDaemon + phase_runs.
 */
export class DropJobScheduler1748600000000 implements MigrationInterface {
  name = "DropJobScheduler1748600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS job_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS job_definitions`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS job_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL,
        params jsonb NOT NULL DEFAULT '{}'::jsonb,
        cron text,
        enabled boolean NOT NULL DEFAULT true,
        priority integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS job_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        definition_id uuid REFERENCES job_definitions(id) ON DELETE SET NULL,
        type text NOT NULL,
        params jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'pending',
        stats jsonb NOT NULL DEFAULT '{}'::jsonb,
        error text,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_job_runs_status_priority
        ON job_runs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_job_runs_definition
        ON job_runs(definition_id, created_at DESC);
    `);
  }
}
