import type { MigrationInterface, QueryRunner } from "typeorm";

/** Фаза 3 read-line: карта только из fold фактов, materialized read_model не нужен. */
export class DropStatusReadModels1750200000000 implements MigrationInterface {
  name = "DropStatusReadModels1750200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS place_status_read_model`);
    await queryRunner.query(`DROP TABLE IF EXISTS region_status_read_model`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_status_read_model (
        region_id uuid PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
        region_code text NOT NULL,
        status_code text NOT NULL,
        state_level state_level NOT NULL,
        action text NOT NULL CHECK (action IN ('raise', 'clear')),
        author_channel_key text,
        winner_event_location_id uuid,
        winner_occurred_at timestamptz NOT NULL,
        stale boolean NOT NULL DEFAULT false,
        stale_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_region_status_read_model_winner
      ON region_status_read_model(winner_occurred_at DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_status_read_model (
        place_id uuid PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        status_code text NOT NULL,
        state_level state_level NOT NULL,
        action text NOT NULL CHECK (action IN ('raise', 'clear')),
        author_channel_key text,
        winner_event_location_id uuid,
        winner_occurred_at timestamptz NOT NULL,
        stale boolean NOT NULL DEFAULT false,
        stale_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_place_status_read_model_region
      ON place_status_read_model(region_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_place_status_read_model_author_region
      ON place_status_read_model(author_channel_key, region_id)
    `);
  }
}
