import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Реестр фаз обогащения (ADR-003). Манифест из кода upsert-ится сюда;
 * админка переключает `enabled`. Eager-подписчик/lazy-планировщик читают
 * включённые фазы отсюда.
 */
export class PhaseDefinitions1748200000000 implements MigrationInterface {
  name = "PhaseDefinitions1748200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS phase_definitions (
        id text PRIMARY KEY,
        kind text NOT NULL,
        stage text,
        enrichers jsonb NOT NULL DEFAULT '[]'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        order_index integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_phase_definitions_kind_enabled
      ON phase_definitions(kind, enabled);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_phase_definitions_kind_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS phase_definitions`);
  }
}
