import type { MigrationInterface, QueryRunner } from "typeorm";

export class ParsedEvents1746481300000 implements MigrationInterface {
  name = "ParsedEvents1746481300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE parsed_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_message_id uuid NOT NULL REFERENCES raw_messages(id) ON DELETE RESTRICT,
        event_type text NOT NULL,
        severity text NOT NULL,
        repeat boolean NOT NULL DEFAULT false,
        count int,
        direction text,
        macro_zone text CHECK (macro_zone IN ('rear', 'front', 'border')),
        parser_version text NOT NULL,
        confidence numeric(3,2) NOT NULL DEFAULT 1.00,
        extras jsonb NOT NULL DEFAULT '{}'::jsonb,
        parsed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_parsed_events_raw_parser UNIQUE(raw_message_id, parser_version)
      );
      CREATE INDEX idx_parsed_events_type ON parsed_events(event_type);
      CREATE INDEX idx_parsed_events_parsed_at ON parsed_events(parsed_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE event_locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parsed_event_id uuid NOT NULL REFERENCES parsed_events(id) ON DELETE CASCADE,
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
        place_id uuid REFERENCES places(id) ON DELETE RESTRICT,
        precision text NOT NULL CHECK (precision IN ('region', 'district', 'city', 'locality', 'settlement')),
        lat numeric(9,6),
        lon numeric(9,6),
        source text NOT NULL CHECK (source IN ('db', 'dadata', 'nominatim', 'llm', 'cache'))
      );
      CREATE INDEX idx_event_locations_parsed_event ON event_locations(parsed_event_id);
      CREATE INDEX idx_event_locations_region ON event_locations(region_id);
    `);

    await queryRunner.query(`
      CREATE TABLE parse_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_message_id uuid NOT NULL REFERENCES raw_messages(id) ON DELETE RESTRICT,
        parser_version text NOT NULL,
        status text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
        errors jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_parse_attempts_raw_message ON parse_attempts(raw_message_id);
      CREATE INDEX idx_parse_attempts_status_created ON parse_attempts(status, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_parse_attempts_status_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_parse_attempts_raw_message`);
    await queryRunner.query(`DROP TABLE IF EXISTS parse_attempts`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_region`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_parsed_event`);
    await queryRunner.query(`DROP TABLE IF EXISTS event_locations`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_parsed_events_parsed_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_parsed_events_type`);
    await queryRunner.query(`DROP TABLE IF EXISTS parsed_events`);
  }
}
