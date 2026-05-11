import type { MigrationInterface, QueryRunner } from "typeorm";

export class IngestTables1746481200000 implements MigrationInterface {
  name = "IngestTables1746481200000";public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE channels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text NOT NULL UNIQUE,
        telegram_target text NOT NULL,
        title text,
        enabled boolean NOT NULL DEFAULT true,
        parse_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_channels_enabled ON channels(enabled);
    `);

    await queryRunner.query(`
      CREATE TABLE raw_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
        telegram_message_id bigint NOT NULL,
        hash text NOT NULL UNIQUE,
        posted_at timestamptz NOT NULL,
        raw_text text NOT NULL,
        raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        edit_date timestamptz,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_raw_messages_channel_msg ON raw_messages(channel_id, telegram_message_id);
      CREATE INDEX idx_raw_messages_channel_posted ON raw_messages(channel_id, posted_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE ingest_cursors (
        channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE RESTRICT,
        last_message_id bigint,
        last_posted_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_cursors`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_channel_posted`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_channel_msg`);
    await queryRunner.query(`DROP TABLE IF EXISTS raw_messages`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_channels_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS channels`);
  }
}
