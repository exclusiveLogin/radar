import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Persisted event-time strobes and H3 state let live and rebuild use
 * the same bounded tracking drain across process restarts.
 */
export class TrackingStrobeState1753300000000 implements MigrationInterface {
  name = "TrackingStrobeState1753300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE state_track_pipeline
      ADD COLUMN IF NOT EXISTS flow_snapshot JSONB NOT NULL DEFAULT '{"vectors":{},"mass":{}}'
    `);
    await queryRunner.query(`
      CREATE TABLE state_track_strobe (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        threat_profile TEXT NOT NULL,
        first_at TIMESTAMPTZ NOT NULL,
        closes_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'final')),
        winner_event_location_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX state_track_strobe_open_idx
        ON state_track_strobe (threat_profile, closes_at)
        WHERE status = 'open';
    `);
    await queryRunner.query(`
      CREATE TABLE state_track_strobe_member (
        event_location_id UUID PRIMARY KEY,
        strobe_id UUID NOT NULL REFERENCES state_track_strobe(id) ON DELETE CASCADE,
        occurred_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX state_track_strobe_member_strobe_idx
        ON state_track_strobe_member (strobe_id, occurred_at, event_location_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS state_track_strobe_member`);
    await queryRunner.query(`DROP TABLE IF EXISTS state_track_strobe`);
    await queryRunner.query(`
      ALTER TABLE state_track_pipeline DROP COLUMN IF EXISTS flow_snapshot
    `);
  }
}
