import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ingest Acquisition: channels, providers, bindings, provider-agnostic raw_messages,
 * telegram extension (O2O), cursors, backfill jobs — целевая схема для чистой БД.
 */
export class IngestTables1746481200000 implements MigrationInterface {
  name = "IngestTables1746481200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE channels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text NOT NULL UNIQUE,
        telegram_target text NOT NULL,
        title text,
        enabled boolean NOT NULL DEFAULT true,
        parse_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        source_kind text NOT NULL DEFAULT 'telegram',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_channels_enabled ON channels(enabled);
    `);

    await queryRunner.query(`
      CREATE TABLE ingest_providers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text NOT NULL UNIQUE,
        title text NOT NULL,
        adapter_kind text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        adapter_config jsonb NOT NULL DEFAULT '{}'::jsonb,
        credential_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_error text,
        last_heartbeat_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ingest_providers_status ON ingest_providers(status);
    `);

    await queryRunner.query(`
      CREATE TABLE ingest_bindings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES ingest_providers(id) ON DELETE CASCADE,
        channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
        binding_key text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        external_target text NOT NULL,
        binding_mode text NOT NULL,
        parse_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        adapter_binding jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider_id, binding_key)
      );
      CREATE INDEX idx_ingest_bindings_enabled ON ingest_bindings(enabled);
      CREATE INDEX idx_ingest_bindings_channel ON ingest_bindings(channel_id);
    `);

    await queryRunner.query(`
      ALTER TABLE channels
        ADD COLUMN provider_id uuid REFERENCES ingest_providers(id) ON DELETE SET NULL,
        ADD COLUMN binding_id uuid REFERENCES ingest_bindings(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE raw_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
        provider_key text NOT NULL,
        source_kind text NOT NULL,
        external_message_id text NOT NULL,
        revision_key text,
        source_sequence text,
        ingest_mode text NOT NULL DEFAULT 'live',
        hash text NOT NULL UNIQUE,
        posted_at timestamptz NOT NULL,
        raw_text text NOT NULL,
        raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX uq_raw_messages_identity
        ON raw_messages (channel_id, provider_key, external_message_id, COALESCE(revision_key, ''));
      CREATE INDEX idx_raw_messages_timeline_desc
        ON raw_messages (channel_id, posted_at DESC, source_sequence DESC NULLS LAST);
      CREATE INDEX idx_raw_messages_timeline_asc
        ON raw_messages (channel_id, posted_at ASC, source_sequence ASC NULLS LAST);
    `);

    await queryRunner.query(`
      CREATE TABLE raw_message_telegram (
        raw_message_id uuid PRIMARY KEY REFERENCES raw_messages(id) ON DELETE CASCADE,
        chat_id bigint NOT NULL,
        message_id bigint NOT NULL,
        edit_date timestamptz,
        peer_type text
      );
      CREATE UNIQUE INDEX uq_raw_message_telegram_identity
        ON raw_message_telegram (chat_id, message_id, COALESCE(edit_date, '1970-01-01'::timestamptz));
      CREATE INDEX idx_raw_message_telegram_message_id ON raw_message_telegram(message_id);
    `);

    await queryRunner.query(`
      CREATE TABLE ingest_cursors (
        channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
        provider_key text NOT NULL,
        live_last_external_id text,
        live_last_posted_at timestamptz,
        live_last_source_sequence text,
        backfill_state jsonb NOT NULL DEFAULT '{}'::jsonb,
        external_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (channel_id, provider_key)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE ingest_backfill_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        binding_id uuid NOT NULL REFERENCES ingest_bindings(id) ON DELETE CASCADE,
        provider_id uuid NOT NULL REFERENCES ingest_providers(id) ON DELETE CASCADE,
        strategy text NOT NULL,
        params jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'pending',
        stats jsonb NOT NULL DEFAULT '{"inserted":0,"duplicates":0,"parsed":0}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ingest_backfill_jobs_status ON ingest_backfill_jobs(status);
      CREATE INDEX idx_ingest_backfill_jobs_binding ON ingest_backfill_jobs(binding_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_backfill_jobs`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_cursors`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_message_telegram_message_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_raw_message_telegram_identity`);
    await queryRunner.query(`DROP TABLE IF EXISTS raw_message_telegram`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_timeline_asc`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_timeline_desc`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_raw_messages_identity`);
    await queryRunner.query(`DROP TABLE IF EXISTS raw_messages`);
    await queryRunner.query(`
      ALTER TABLE channels
        DROP COLUMN IF EXISTS binding_id,
        DROP COLUMN IF EXISTS provider_id;
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ingest_bindings_channel`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ingest_bindings_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_bindings`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ingest_providers_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_providers`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_channels_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS channels`);
  }
}
