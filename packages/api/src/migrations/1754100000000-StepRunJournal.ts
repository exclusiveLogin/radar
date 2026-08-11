import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Журнал запусков declarative step (log_step_run) + FK из log_phase_run.
 */
export class StepRunJournal1754100000000 implements MigrationInterface {
  name = "StepRunJournal1754100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS log_step_run (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        step_id text NOT NULL,
        run_id text NOT NULL UNIQUE,
        lane text NOT NULL,
        isolate boolean NOT NULL DEFAULT false,
        trigger_topic text NOT NULL,
        trigger_source text NOT NULL,
        correlation_id text NOT NULL,
        status text NOT NULL DEFAULT 'running',
        stats jsonb NOT NULL DEFAULT '{}'::jsonb,
        suppressed_emits jsonb NOT NULL DEFAULT '[]'::jsonb,
        started_at timestamptz NULL,
        finished_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_log_step_run_step_id
        ON log_step_run (step_id)
    `);

    await queryRunner.query(`
      ALTER TABLE log_phase_run
        ADD COLUMN IF NOT EXISTS step_run_id uuid NULL
          REFERENCES log_step_run(id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE log_phase_run
        DROP COLUMN IF EXISTS step_run_id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS log_step_run`);
  }
}
