import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Денормализованный channel_key в parse_attempts: фильтр лога парсинга и
 * агрегаты по каналу без JOIN к raw_messages/channels.
 */
export class ParseAttemptChannelKey1747500000000 implements MigrationInterface {
  name = "ParseAttemptChannelKey1747500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE parse_attempts ADD COLUMN IF NOT EXISTS channel_key text;
      CREATE INDEX IF NOT EXISTS idx_parse_attempts_channel_created
        ON parse_attempts(channel_key, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_parse_attempts_channel_created`);
    await queryRunner.query(`ALTER TABLE parse_attempts DROP COLUMN IF EXISTS channel_key`);
  }
}
