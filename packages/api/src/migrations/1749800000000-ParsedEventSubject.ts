import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Добавляет поле event_subject в parsed_events.
 * Субъект угрозы: drone | rocket | mws | aviation | other.
 * Nullable — проставляется парсером и/или LLM-обогатителем.
 */
export class ParsedEventSubject1749800000000 implements MigrationInterface {
  name = "ParsedEventSubject1749800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE parsed_events
        ADD COLUMN IF NOT EXISTS event_subject text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE parsed_events
        DROP COLUMN IF EXISTS event_subject;
    `);
  }
}
