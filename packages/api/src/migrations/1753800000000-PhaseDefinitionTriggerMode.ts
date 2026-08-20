import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SSOT пробуждения фазы: колонка trigger_mode (event|timeout|both|manual).
 * Убирает lossy-маппинг legacy trigger ↔ triggerMode (both↔eager ломался).
 */
export class PhaseDefinitionTriggerMode1753800000000 implements MigrationInterface {
  name = "PhaseDefinitionTriggerMode1753800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE phase_definitions
        ADD COLUMN IF NOT EXISTS trigger_mode text
    `);

    // Известные id из deployment defaults — точный SSOT, не через lossy map.
    await queryRunner.query(`
      UPDATE phase_definitions SET trigger_mode = CASE id
        WHEN 'catalog' THEN 'event'
        WHEN 'llm' THEN 'both'
        WHEN 'dadata' THEN 'both'
        WHEN 'nominatim' THEN 'both'
        WHEN 'geo-llm' THEN 'both'
        WHEN 'geo-dadata' THEN 'both'
        WHEN 'geo-nominatim' THEN 'both'
        ELSE trigger_mode
      END
      WHERE trigger_mode IS NULL
    `);

    // Неизвестные id: эвристика от legacy trigger (scheduled ≈ both).
    await queryRunner.query(`
      UPDATE phase_definitions SET trigger_mode = CASE trigger
        WHEN 'eager' THEN 'event'
        WHEN 'manual' THEN 'manual'
        WHEN 'scheduled' THEN 'both'
        ELSE 'both'
      END
      WHERE trigger_mode IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE phase_definitions
        ALTER COLUMN trigger_mode SET NOT NULL
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_phase_definitions_scope_trigger_enabled;
      DROP INDEX IF EXISTS idx_phase_definitions_trigger_enabled;
      CREATE INDEX IF NOT EXISTS idx_phase_definitions_scope_trigger_mode_enabled
        ON phase_definitions(scope, trigger_mode, enabled)
    `);

    // Legacy колонка trigger больше не источник правды — синхронизируем для читателей SQL/отчётов, затем drop.
    await queryRunner.query(`
      UPDATE phase_definitions SET trigger = CASE trigger_mode
        WHEN 'manual' THEN 'manual'
        WHEN 'timeout' THEN 'scheduled'
        ELSE 'eager'
      END
    `);

    await queryRunner.query(`
      ALTER TABLE phase_definitions DROP COLUMN IF EXISTS trigger
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE phase_definitions
        ADD COLUMN IF NOT EXISTS trigger text
    `);

    await queryRunner.query(`
      UPDATE phase_definitions SET trigger = CASE trigger_mode
        WHEN 'manual' THEN 'manual'
        WHEN 'timeout' THEN 'scheduled'
        ELSE 'eager'
      END
      WHERE trigger IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE phase_definitions
        ALTER COLUMN trigger SET NOT NULL
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_phase_definitions_scope_trigger_mode_enabled;
      CREATE INDEX IF NOT EXISTS idx_phase_definitions_scope_trigger_enabled
        ON phase_definitions(scope, trigger, enabled)
    `);

    await queryRunner.query(`
      ALTER TABLE phase_definitions DROP COLUMN IF EXISTS trigger_mode
    `);
  }
}
