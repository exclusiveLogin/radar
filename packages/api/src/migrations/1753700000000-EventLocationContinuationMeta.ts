import type { MigrationInterface, QueryRunner } from "typeorm";

/** Хранит маркер continuation у самостоятельного status-fact. */
export class EventLocationContinuationMeta1753700000000 implements MigrationInterface {
  name = "EventLocationContinuationMeta1753700000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mat_parse_location
        ADD COLUMN IF NOT EXISTS meta JSONB NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mat_parse_location
        DROP COLUMN IF EXISTS meta;
    `);
  }
}
