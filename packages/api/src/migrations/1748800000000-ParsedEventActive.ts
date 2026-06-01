import type { MigrationInterface, QueryRunner } from "typeorm";

/** Видимость parsed_event на карте/ленте: LLM/other → is_active=false, строка остаётся в архиве. */
export class ParsedEventActive1748800000000 implements MigrationInterface {
  name = "ParsedEventActive1748800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE parsed_events
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS inactive_reason text;

      CREATE INDEX IF NOT EXISTS idx_parsed_events_active_parsed_at
        ON parsed_events (parsed_at DESC)
        WHERE is_active = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_parsed_events_active_parsed_at;
      ALTER TABLE parsed_events
        DROP COLUMN IF EXISTS inactive_reason,
        DROP COLUMN IF EXISTS is_active;
    `);
  }
}
