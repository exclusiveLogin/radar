import type { MigrationInterface, QueryRunner } from "typeorm";

export class EventLocationFactsAndReadModels1748900000000 implements MigrationInterface {
  name = "EventLocationFactsAndReadModels1748900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_locations
      ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'region',
      ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
      ADD COLUMN IF NOT EXISTS author_channel_key text,
      ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'raise',
      ADD COLUMN IF NOT EXISTS status_code text,
      ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
    `);

    await queryRunner.query(`
      ALTER TABLE event_locations
      DROP CONSTRAINT IF EXISTS event_locations_entity_kind_check;
      ALTER TABLE event_locations
      ADD CONSTRAINT event_locations_entity_kind_check
      CHECK (entity_kind IN ('region','place','point'));
    `);

    await queryRunner.query(`
      ALTER TABLE event_locations
      DROP CONSTRAINT IF EXISTS event_locations_action_check;
      ALTER TABLE event_locations
      ADD CONSTRAINT event_locations_action_check
      CHECK (action IN ('raise','clear'));
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_event_locations_region_occurred_at
      ON event_locations(region_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_locations_author_region
      ON event_locations(author_channel_key, region_id);
      CREATE INDEX IF NOT EXISTS idx_event_locations_place_occurred_at
      ON event_locations(place_id, occurred_at DESC)
      WHERE place_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_status_read_model (
        region_id uuid PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
        region_code text NOT NULL,
        status_code text NOT NULL,
        state_level text NOT NULL,
        action text NOT NULL CHECK (action IN ('raise','clear')),
        author_channel_key text,
        winner_event_location_id uuid REFERENCES event_locations(id) ON DELETE SET NULL,
        winner_occurred_at timestamptz NOT NULL,
        stale boolean NOT NULL DEFAULT false,
        stale_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_region_status_read_model_winner
      ON region_status_read_model(winner_occurred_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_status_read_model (
        place_id uuid PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        status_code text NOT NULL,
        state_level text NOT NULL,
        action text NOT NULL CHECK (action IN ('raise','clear')),
        author_channel_key text,
        winner_event_location_id uuid REFERENCES event_locations(id) ON DELETE SET NULL,
        winner_occurred_at timestamptz NOT NULL,
        stale boolean NOT NULL DEFAULT false,
        stale_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_place_status_read_model_region
      ON place_status_read_model(region_id);
      CREATE INDEX IF NOT EXISTS idx_place_status_read_model_author_region
      ON place_status_read_model(author_channel_key, region_id);
    `);

    await queryRunner.query(`
      INSERT INTO status_dictionary(code, title, include_on_map, parser_hints, is_active, priority, state_level)
      SELECT 'stale', 'Протухшее состояние', true, ARRAY['stale'], true, 95, 'yellow'
      WHERE NOT EXISTS (SELECT 1 FROM status_dictionary WHERE code='stale');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM status_dictionary WHERE code='stale'`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_status_read_model`);
    await queryRunner.query(`DROP TABLE IF EXISTS region_status_read_model`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_place_occurred_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_author_region`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_region_occurred_at`);

    await queryRunner.query(`
      ALTER TABLE event_locations
      DROP COLUMN IF EXISTS occurred_at,
      DROP COLUMN IF EXISTS status_code,
      DROP COLUMN IF EXISTS action,
      DROP COLUMN IF EXISTS author_channel_key,
      DROP COLUMN IF EXISTS confidence,
      DROP COLUMN IF EXISTS entity_kind;
    `);
  }
}
