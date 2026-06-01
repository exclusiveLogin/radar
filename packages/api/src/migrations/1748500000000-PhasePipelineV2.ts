import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase-pipeline v2: trigger/policy в phase_definitions; enrichment_queue → phase_coverage;
 * phase_runs для прогресса и управления.
 */
export class PhasePipelineV21748500000000 implements MigrationInterface {
  name = "PhasePipelineV21748500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE phase_definitions
        ADD COLUMN IF NOT EXISTS trigger text,
        ADD COLUMN IF NOT EXISTS policy jsonb NOT NULL DEFAULT '{}'::jsonb;
    `);

    await queryRunner.query(`
      UPDATE phase_definitions SET
        id = CASE id
          WHEN 'parse' THEN 'catalog'
          WHEN 'enrich-llm' THEN 'llm'
          WHEN 'enrich-dadata' THEN 'dadata'
          WHEN 'enrich-nominatim' THEN 'nominatim'
          ELSE id
        END,
        trigger = CASE
          WHEN kind = 'eager' THEN 'eager'
          WHEN kind = 'lazy' THEN 'scheduled'
          ELSE COALESCE(trigger, 'scheduled')
        END
      WHERE trigger IS NULL OR id IN ('parse', 'enrich-llm', 'enrich-dadata', 'enrich-nominatim');
    `);

    await queryRunner.query(`
      ALTER TABLE phase_definitions ALTER COLUMN trigger SET NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_phase_definitions_trigger_enabled
        ON phase_definitions(trigger, enabled);
    `);

    await queryRunner.query(`
      ALTER TABLE enrichment_queue RENAME TO phase_coverage;
      ALTER TABLE phase_coverage RENAME COLUMN stage TO phase_id;
      ALTER TABLE phase_coverage DROP CONSTRAINT IF EXISTS uq_enrichment_queue_raw_stage;
      ALTER TABLE phase_coverage
        ADD CONSTRAINT uq_phase_coverage_raw_phase UNIQUE (raw_message_id, phase_id);
      DROP INDEX IF EXISTS idx_enrichment_queue_stage_status_created;
      CREATE INDEX IF NOT EXISTS idx_phase_coverage_phase_status_created
        ON phase_coverage(phase_id, status, created_at);
      ALTER TABLE phase_coverage
        ADD COLUMN IF NOT EXISTS processed_at timestamptz;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS phase_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phase_id text NOT NULL REFERENCES phase_definitions(id) ON DELETE CASCADE,
        trigger text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        stats jsonb NOT NULL DEFAULT '{}'::jsonb,
        log jsonb NOT NULL DEFAULT '[]'::jsonb,
        control text,
        error text,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_phase_runs_phase_status
        ON phase_runs(phase_id, status);
      CREATE INDEX IF NOT EXISTS idx_phase_runs_status_created
        ON phase_runs(status, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS phase_runs`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_phase_coverage_phase_status_created`);
    await queryRunner.query(`
      ALTER TABLE phase_coverage DROP CONSTRAINT IF EXISTS uq_phase_coverage_raw_phase;
      ALTER TABLE phase_coverage RENAME COLUMN phase_id TO stage;
      ALTER TABLE phase_coverage RENAME TO enrichment_queue;
    `);
    await queryRunner.query(`
      ALTER TABLE phase_definitions DROP COLUMN IF EXISTS trigger;
      ALTER TABLE phase_definitions DROP COLUMN IF EXISTS policy;
      DROP INDEX IF EXISTS idx_phase_definitions_trigger_enabled;
    `);
  }
}
