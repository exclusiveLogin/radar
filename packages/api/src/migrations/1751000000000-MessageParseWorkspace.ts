import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Parse Workspace: interpretation layer + multi-event per raw (drop unique raw+parser).
 */
export class MessageParseWorkspace1751000000000 implements MigrationInterface {
  name = "MessageParseWorkspace1751000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE parsed_events
      DROP CONSTRAINT IF EXISTS uq_parsed_events_raw_parser;
    `);

    await queryRunner.query(`
      CREATE TABLE message_parse_workspace (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_message_id uuid NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
        parser_revision text NOT NULL DEFAULT '1',
        status text NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'finalized', 'superseded', 'invalid')),
        groomed_text text NOT NULL,
        workspace jsonb NOT NULL,
        spawned_event_ids uuid[] NOT NULL DEFAULT '{}',
        candidate_event_map jsonb NOT NULL DEFAULT '{}',
        finalized_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX message_parse_workspace_active_raw_idx
        ON message_parse_workspace (raw_message_id)
        WHERE status = 'finalized';
    `);

    await queryRunner.query(`
      CREATE INDEX message_parse_workspace_raw_idx
        ON message_parse_workspace (raw_message_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS message_parse_workspace_raw_idx`);
    await queryRunner.query(`DROP INDEX IF EXISTS message_parse_workspace_active_raw_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS message_parse_workspace`);

    await queryRunner.query(`
      ALTER TABLE parsed_events
      ADD CONSTRAINT uq_parsed_events_raw_parser UNIQUE (raw_message_id, parser_version);
    `);
  }
}
