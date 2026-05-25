import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Апгрейд legacy-схемы (telegram_message_id в raw_messages, PK ingest_cursors по channel_id).
 * На чистой БД после IngestTables1746481200000 — no-op.
 */
export class IngestProviders1747100000000 implements MigrationInterface {
  name = "IngestProviders1747100000000";

  private async columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await queryRunner.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS "exists"
      `,
      [table, column],
    );
    return Boolean(rows[0]?.exists);
  }

  private async tableExists(queryRunner: QueryRunner, table: string): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await queryRunner.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS "exists"
      `,
      [table],
    );
    return Boolean(rows[0]?.exists);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const legacyRaw = await this.columnExists(queryRunner, "raw_messages", "telegram_message_id");
    if (!legacyRaw) {
      return;
    }

    const hasProviders = await this.tableExists(queryRunner, "ingest_providers");
    if (!hasProviders) {
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
    }

    const hasBindings = await this.tableExists(queryRunner, "ingest_bindings");
    if (!hasBindings) {
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
      `);
    }

    if (!(await this.columnExists(queryRunner, "channels", "source_kind"))) {
      await queryRunner.query(`
        ALTER TABLE channels
          ADD COLUMN provider_id uuid REFERENCES ingest_providers(id) ON DELETE SET NULL,
          ADD COLUMN binding_id uuid REFERENCES ingest_bindings(id) ON DELETE SET NULL,
          ADD COLUMN source_kind text NOT NULL DEFAULT 'telegram';
      `);
    }

    if (!(await this.columnExists(queryRunner, "raw_messages", "provider_key"))) {
      await queryRunner.query(`
        ALTER TABLE raw_messages
          ADD COLUMN provider_key text NOT NULL DEFAULT 'legacy',
          ADD COLUMN source_kind text NOT NULL DEFAULT 'telegram',
          ADD COLUMN external_message_id text,
          ADD COLUMN revision_key text,
          ADD COLUMN source_sequence text,
          ADD COLUMN ingest_mode text NOT NULL DEFAULT 'live';
      `);
    }

    await queryRunner.query(`
      UPDATE raw_messages
      SET external_message_id = telegram_message_id::text
      WHERE external_message_id IS NULL;
    `);

    if (await this.columnExists(queryRunner, "raw_messages", "edit_date")) {
      await queryRunner.query(`
        UPDATE raw_messages
        SET revision_key = to_char(edit_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        WHERE edit_date IS NOT NULL AND revision_key IS NULL;
      `);
    }

    await queryRunner.query(`
      ALTER TABLE raw_messages
        ALTER COLUMN external_message_id SET NOT NULL;
    `);

    const hasTgExt = await this.tableExists(queryRunner, "raw_message_telegram");
    if (!hasTgExt) {
      await queryRunner.query(`
        CREATE TABLE raw_message_telegram (
          raw_message_id uuid PRIMARY KEY REFERENCES raw_messages(id) ON DELETE CASCADE,
          chat_id bigint NOT NULL DEFAULT 0,
          message_id bigint NOT NULL,
          edit_date timestamptz,
          peer_type text
        );
      `);

      await queryRunner.query(`
        INSERT INTO raw_message_telegram (raw_message_id, chat_id, message_id, edit_date)
        SELECT id, 0, telegram_message_id::bigint, edit_date
        FROM raw_messages
        WHERE source_kind = 'telegram'
        ON CONFLICT (raw_message_id) DO NOTHING;
      `);

      await queryRunner.query(`
        CREATE UNIQUE INDEX uq_raw_message_telegram_identity
          ON raw_message_telegram (chat_id, message_id, COALESCE(edit_date, '1970-01-01'::timestamptz));
        CREATE INDEX idx_raw_message_telegram_message_id ON raw_message_telegram(message_id);
      `);
    }

    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_channel_msg`);

    if (await this.columnExists(queryRunner, "raw_messages", "telegram_message_id")) {
      await queryRunner.query(`
        ALTER TABLE raw_messages DROP COLUMN telegram_message_id;
      `);
    }
    if (await this.columnExists(queryRunner, "raw_messages", "edit_date")) {
      await queryRunner.query(`
        ALTER TABLE raw_messages DROP COLUMN edit_date;
      `);
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_messages_identity
        ON raw_messages (channel_id, provider_key, external_message_id, COALESCE(revision_key, ''));
      CREATE INDEX IF NOT EXISTS idx_raw_messages_timeline_desc
        ON raw_messages (channel_id, posted_at DESC, source_sequence DESC NULLS LAST);
      CREATE INDEX IF NOT EXISTS idx_raw_messages_timeline_asc
        ON raw_messages (channel_id, posted_at ASC, source_sequence ASC NULLS LAST);
    `);

    const legacyCursor = await this.columnExists(queryRunner, "ingest_cursors", "last_message_id");
    if (legacyCursor) {
      if (!(await this.columnExists(queryRunner, "ingest_cursors", "provider_key"))) {
        await queryRunner.query(`
          ALTER TABLE ingest_cursors
            ADD COLUMN provider_key text NOT NULL DEFAULT 'legacy',
            ADD COLUMN live_last_external_id text,
            ADD COLUMN live_last_posted_at timestamptz,
            ADD COLUMN live_last_source_sequence text,
            ADD COLUMN backfill_state jsonb NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN external_cursor jsonb NOT NULL DEFAULT '{}'::jsonb;
        `);
      }

      await queryRunner.query(`
        UPDATE ingest_cursors
        SET live_last_external_id = last_message_id::text,
            live_last_posted_at = last_posted_at
        WHERE last_message_id IS NOT NULL;
      `);

      await queryRunner.query(`
        ALTER TABLE ingest_cursors DROP COLUMN last_message_id;
        ALTER TABLE ingest_cursors DROP COLUMN IF EXISTS last_posted_at;
      `);

      await queryRunner.query(`
        ALTER TABLE ingest_cursors DROP CONSTRAINT IF EXISTS ingest_cursors_pkey;
        ALTER TABLE ingest_cursors ADD PRIMARY KEY (channel_id, provider_key);
      `);
    }

    const hasBackfill = await this.tableExists(queryRunner, "ingest_backfill_jobs");
    if (!hasBackfill) {
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
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const legacyRaw = await this.columnExists(queryRunner, "raw_messages", "telegram_message_id");
    if (legacyRaw) {
      return;
    }

    await queryRunner.query(`DROP TABLE IF EXISTS ingest_backfill_jobs`);

    const hasProviderKey = await this.columnExists(queryRunner, "ingest_cursors", "provider_key");
    if (hasProviderKey) {
      await queryRunner.query(`
        ALTER TABLE ingest_cursors DROP CONSTRAINT IF EXISTS ingest_cursors_pkey;
        ALTER TABLE ingest_cursors ADD PRIMARY KEY (channel_id);
        ALTER TABLE ingest_cursors
          ADD COLUMN IF NOT EXISTS last_message_id bigint,
          ADD COLUMN IF NOT EXISTS last_posted_at timestamptz,
          DROP COLUMN IF EXISTS provider_key,
          DROP COLUMN IF EXISTS live_last_external_id,
          DROP COLUMN IF EXISTS live_last_posted_at,
          DROP COLUMN IF EXISTS live_last_source_sequence,
          DROP COLUMN IF EXISTS backfill_state,
          DROP COLUMN IF EXISTS external_cursor;
      `);
    }

    await queryRunner.query(`DROP INDEX IF EXISTS uq_raw_messages_identity`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_timeline_desc`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_timeline_asc`);

    await queryRunner.query(`
      ALTER TABLE raw_messages
        ADD COLUMN IF NOT EXISTS telegram_message_id bigint,
        ADD COLUMN IF NOT EXISTS edit_date timestamptz;
    `);

    await queryRunner.query(`
      UPDATE raw_messages rm
      SET telegram_message_id = rmt.message_id,
          edit_date = rmt.edit_date
      FROM raw_message_telegram rmt
      WHERE rm.id = rmt.raw_message_id AND rm.telegram_message_id IS NULL;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS raw_message_telegram`);

    await queryRunner.query(`
      ALTER TABLE raw_messages
        DROP COLUMN IF EXISTS provider_key,
        DROP COLUMN IF EXISTS source_kind,
        DROP COLUMN IF EXISTS external_message_id,
        DROP COLUMN IF EXISTS revision_key,
        DROP COLUMN IF EXISTS source_sequence,
        DROP COLUMN IF EXISTS ingest_mode;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_messages_channel_msg
        ON raw_messages(channel_id, telegram_message_id);
    `);

    await queryRunner.query(`
      ALTER TABLE channels
        DROP COLUMN IF EXISTS provider_id,
        DROP COLUMN IF EXISTS binding_id,
        DROP COLUMN IF EXISTS source_kind;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS ingest_bindings`);
    await queryRunner.query(`DROP TABLE IF EXISTS ingest_providers`);
  }
}
