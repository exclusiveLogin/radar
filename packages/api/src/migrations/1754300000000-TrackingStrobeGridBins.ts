import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Сетка бинов floor(t/window): unique (threat_profile, first_at).
 * Плавающие стробы и построенные по ним треки инвалидны — полный L1 wipe.
 */
export class TrackingStrobeGridBins1754300000000 implements MigrationInterface {
  name = "TrackingStrobeGridBins1754300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      TRUNCATE TABLE state_track_strobe_member, state_track_strobe,
        state_track_consumed, mat_track_node, mat_track RESTART IDENTITY CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS state_track_strobe_bin_uidx
      ON state_track_strobe (threat_profile, first_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS mat_track_last_at_idx
      ON mat_track (last_at)
    `);
    await queryRunner.query(`
      UPDATE job_track_rebuild
      SET status = 'cancelled', finished_at = now(),
          control = COALESCE(control, '{}'::jsonb) || '{"cancel":true}'::jsonb
      WHERE status IN ('running', 'paused')
    `);
    await queryRunner.query(`
      UPDATE state_track_pipeline
      SET watermark = '{}'::jsonb,
          flow_snapshot = '{"vectors":{},"mass":{}}'::jsonb,
          active_run_id = NULL,
          updated_at = now()
      WHERE id = 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS mat_track_last_at_idx`);
    await queryRunner.query(`DROP INDEX IF EXISTS state_track_strobe_bin_uidx`);
  }
}
