import type { MigrationInterface, QueryRunner } from "typeorm";

export class PhaseDefinitionScope1749200000000 implements MigrationInterface {
  name = "PhaseDefinitionScope1749200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE phase_definitions
      ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'ingestParse';
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_phase_definitions_scope_trigger_enabled
      ON phase_definitions(scope, trigger, enabled);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_phase_definitions_scope_trigger_enabled`);
    await queryRunner.query(`ALTER TABLE phase_definitions DROP COLUMN IF EXISTS scope`);
  }
}
