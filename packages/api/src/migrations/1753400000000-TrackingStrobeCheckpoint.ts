import type { MigrationInterface, QueryRunner } from "typeorm";

/** Текущее решение strobe и граница локального replay. */
export class TrackingStrobeCheckpoint1753400000000 implements MigrationInterface {
  name = "TrackingStrobeCheckpoint1753400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE state_track_strobe
      ADD COLUMN IF NOT EXISTS winner_event_location_ids JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS replay_from TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE state_track_strobe
      DROP COLUMN IF EXISTS replay_from,
      DROP COLUMN IF EXISTS winner_event_location_ids
    `);
  }
}
