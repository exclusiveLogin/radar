import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Persisted busy→stabilized claim для cascade-триггеров между pipeline/репликами.
 * @see packages/worker/src/application/runtime/runner-platform/stabilityEngine.ts
 */
export class PipelineStability1754000000000 implements MigrationInterface {
  name = "PipelineStability1754000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS state_pipeline_stability (
        scope_key text PRIMARY KEY,
        status text NOT NULL DEFAULT 'busy'
          CHECK (status IN ('busy', 'stabilized')),
        generation int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS state_pipeline_stability`);
  }
}
