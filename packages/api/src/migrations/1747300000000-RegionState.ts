import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Проекция операционного состояния регионов: текущий срез + история смен.
 * Уровень липкий (green до новой угрозы), не выводится из max severity — нужна отдельная таблица.
 */
export class RegionState1747300000000 implements MigrationInterface {
  name = "RegionState1747300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_state_active (
        region_id uuid PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
        region_code text NOT NULL,
        state_level text NOT NULL DEFAULT 'grey',
        self_level text NOT NULL DEFAULT 'grey',
        activity integer NOT NULL DEFAULT 0,
        reason text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_region_state_active_level
      ON region_state_active(state_level, updated_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_state_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        region_code text NOT NULL,
        state_level text NOT NULL,
        previous_level text NOT NULL,
        reason text,
        changed_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_region_state_history_region_time
      ON region_state_history(region_id, changed_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_region_state_history_region_time`);
    await queryRunner.query(`DROP TABLE IF EXISTS region_state_history`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_region_state_active_level`);
    await queryRunner.query(`DROP TABLE IF EXISTS region_state_active`);
  }
}
