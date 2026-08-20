import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Snapshot H3-поля после materialization strobe.
 * Он является единственной корректной точкой восстановления перед tail replay.
 */
export class TrackingStrobeFlowCheckpoint1753600000000 implements MigrationInterface {
  name = "TrackingStrobeFlowCheckpoint1753600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE state_track_strobe
      ADD COLUMN IF NOT EXISTS flow_snapshot JSONB
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS state_track_strobe_checkpoint_idx
      ON state_track_strobe (first_at, id)
      WHERE flow_snapshot IS NOT NULL
    `);
    // До этой миграции checkpoint до replay boundary не существовал. L1 — derived
    // state, поэтому инвалидируем его вместо публикации неточного prefix FlowMap.
    await queryRunner.query(`
      TRUNCATE TABLE state_track_strobe_member, state_track_strobe,
        state_track_consumed, mat_track_node, mat_track RESTART IDENTITY CASCADE
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
    await queryRunner.query(`
      DROP INDEX IF EXISTS state_track_strobe_checkpoint_idx
    `);
    await queryRunner.query(`
      ALTER TABLE state_track_strobe
      DROP COLUMN IF EXISTS flow_snapshot
    `);
  }
}
